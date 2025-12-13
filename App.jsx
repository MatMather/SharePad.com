import React, { useState, useEffect, useRef, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInAnonymously, 
  onAuthStateChanged,
  signInWithCustomToken
} from 'firebase/auth';
import { 
  getFirestore, 
  doc, 
  setDoc, 
  onSnapshot, 
  serverTimestamp,
  collection,
  addDoc,
  deleteDoc
} from 'firebase/firestore';
import { 
  Image as ImageIcon, 
  Share2, 
  Upload, 
  Trash2, 
  Download, 
  Loader2, 
  Link as LinkIcon,
  Copy,
  Check,
  X,
  Folder as FolderIconLucide,
  FileText
} from 'lucide-react';

// --- Configuração do Firebase ---
const firebaseConfig = JSON.parse(__firebase_config);
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// --- Utilitários ---
const compressImage = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        // Mantemos 800px para bom equilíbrio entre qualidade e velocidade
        const MAX_WIDTH = 800;
        const scaleSize = MAX_WIDTH / img.width;
        canvas.width = MAX_WIDTH;
        canvas.height = img.height * scaleSize;
        
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        
        // JPEG 0.6
        const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
        resolve(dataUrl);
      };
      img.onerror = (error) => reject(error);
    };
    reader.onerror = (error) => reject(error);
  });
};

const debounce = (func, wait) => {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
};

// Formata data de forma segura
const safeFormatTime = (timestamp) => {
  if (!timestamp) return '';
  if (timestamp.toDate) return timestamp.toDate().toLocaleTimeString();
  if (timestamp.seconds) return new Date(timestamp.seconds * 1000).toLocaleTimeString();
  return new Date(timestamp).toLocaleTimeString();
};

// --- Componente Principal ---
export default function App() {
  const [user, setUser] = useState(null);
  const [currentPath, setCurrentPath] = useState('');
  const [inputValue, setInputValue] = useState('');
  
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Erro na autenticação:", err);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  const navigateToRoom = (path) => {
    const cleanPath = path.trim().replace(/[^a-zA-Z0-9-_]/g, '').toLowerCase();
    if (cleanPath) {
      setCurrentPath(cleanPath);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-gray-900">
      {!currentPath ? (
        <LandingPage onNavigate={navigateToRoom} inputValue={inputValue} setInputValue={setInputValue} />
      ) : (
        <Room slug={currentPath} onExit={() => setCurrentPath('')} user={user} />
      )}
    </div>
  );
}

// --- Tela Inicial ---
function LandingPage({ onNavigate, inputValue, setInputValue }) {
  const handleSubmit = (e) => {
    e.preventDefault();
    onNavigate(inputValue);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-gradient-to-br from-blue-50 to-indigo-50">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl overflow-hidden">
        <div className="bg-blue-600 p-8 text-center">
          <h1 className="text-3xl font-bold text-white mb-2 flex items-center justify-center gap-2">
            <Share2 className="w-8 h-8" /> SharePad
          </h1>
          <p className="text-blue-100">
            Texto, pastas e fotos ilimitadas, instantaneamente.
          </p>
        </div>
        
        <div className="p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Escolha o nome da sua sala
              </label>
              <div className="relative">
                <span className="absolute left-3 top-3 text-gray-400 font-mono">/</span>
                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder="ex: festa-surpresa"
                  className="w-full pl-6 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                  autoFocus
                />
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Dica: Use um nome único para manter seus dados privados.
              </p>
            </div>
            
            <button
              type="submit"
              disabled={!inputValue.trim()}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Acessar <LinkIcon className="w-4 h-4" />
            </button>
          </form>
        </div>
        
        <div className="bg-gray-50 p-4 border-t border-gray-100 text-center text-sm text-gray-500">
          Sem login. Sem limites. Apenas colaboração.
        </div>
      </div>
    </div>
  );
}

// --- Componente da Sala ---
function Room({ slug, onExit, user }) {
  const [text, setText] = useState('');
  const [images, setImages] = useState([]);
  const [status, setStatus] = useState('sincronizado');
  const [uploading, setUploading] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const textareaRef = useRef(null);
  const [copied, setCopied] = useState(false);
  
  // Modals/Dialogs
  const [showCreationModal, setShowCreationModal] = useState(false);
  const [creationType, setCreationType] = useState(null); // 'folder' or 'document'
  const [showConfirmModal, setShowConfirmModal] = useState(null); // { message, onConfirm }
  const [showRenameModal, setShowRenameModal] = useState(null); // { item, onRename }

  // Estados para navegação de arquivos/pastas
  const [currentFileId, setCurrentFileId] = useState(null); 
  const [currentFolderName, setCurrentFolderName] = useState('Raiz'); 
  const [currentFolderId, setCurrentFolderId] = useState(null); 
  const [folderContent, setFolderContent] = useState([]); 
  const [allItems, setAllItems] = useState([]); 
  
  // Referências do Firebase
  const roomFilesColRef = collection(db, 'artifacts', appId, 'public', 'data', `sharepad_files_${slug}`);
  const textDocRef = currentFileId ? doc(roomFilesColRef, currentFileId) : null;
  const imagesColRef = collection(db, 'artifacts', appId, 'public', 'data', `sharepad_images_${slug}`);

  // 1. Sincronização de Arquivos/Pastas (Conteúdo da Pasta Atual e Lista Total)
  useEffect(() => {
    const unsubscribe = onSnapshot(roomFilesColRef, (snapshot) => {
        const items = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        
        setAllItems(items); 
        
        const content = items
            .filter(item => item.parent === currentFolderId)
            .sort((a, b) => {
                if (a.type === 'folder' && b.type !== 'folder') return -1;
                if (a.type !== 'folder' && b.type === 'folder') return 1;
                return a.name.localeCompare(b.name);
            });
            
        setFolderContent(content);
        
        if (currentFolderId) {
            const folder = items.find(item => item.id === currentFolderId && item.type === 'folder');
            setCurrentFolderName(folder ? folder.name : 'Pasta Não Encontrada');
        } else {
            setCurrentFolderName('Raiz');
        }

    }, (error) => {
        console.error("Erro ao sincronizar arquivos:", error);
    });
    return () => unsubscribe();
  }, [slug, currentFolderId]);
  
  // 2. Sincronização de Texto (Carrega o conteúdo do arquivo selecionado)
  useEffect(() => {
    if (!textDocRef) {
        setText('');
        return;
    }
    
    setStatus('sincronizando documento...');
    const unsubscribe = onSnapshot(textDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (document.activeElement !== textareaRef.current) {
          setText(data.content || '');
        }
        setStatus('documento sincronizado');
      } else {
        setCurrentFileId(null);
        setText('');
        setStatus('documento não encontrado');
      }
    }, (error) => {
      console.error("Erro texto:", error);
      setStatus('erro conexão texto');
    });
    return () => unsubscribe();
  }, [currentFileId]);

  // 3. Sincronização de Imagens
  useEffect(() => {
    const unsubscribe = onSnapshot(imagesColRef, (snapshot) => {
      const loadedImgs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      loadedImgs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setImages(loadedImgs);
    }, (error) => {
      console.error("Erro imagens:", error);
    });
    return () => unsubscribe();
  }, [slug]);

  // 4. Salvar Texto (Debounce)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedSave = useCallback(
    debounce(async (newText) => {
      if (!textDocRef) return;
      setStatus('salvando...');
      try {
        await setDoc(textDocRef, { content: newText, updatedAt: serverTimestamp() }, { merge: true });
        setStatus('documento sincronizado');
      } catch (e) {
        console.error(e);
        setStatus('erro ao salvar');
      }
    }, 1000),
    [textDocRef]
  );

  const handleTextChange = (e) => {
    const newVal = e.target.value;
    setText(newVal);
    debouncedSave(newVal);
  };
  
  // 5. Handlers de Navegação e Criação
  const navigateToFolder = (itemId) => {
    setCurrentFolderId(itemId);
    setCurrentFileId(null);
  };

  const openDocument = (itemId) => {
    setCurrentFileId(itemId);
  };

  const goBack = () => {
    // 1. Se estiver editando um arquivo, volte para a visualização da pasta
    if (currentFileId) {
      setCurrentFileId(null); 
      return; 
    }
    
    // 2. Se estiver em uma pasta, encontre o pai
    if (currentFolderId) {
        const currentFolder = allItems.find(i => i.id === currentFolderId);
        
        if (currentFolder && currentFolder.parent !== undefined) {
            setCurrentFolderId(currentFolder.parent);
        } else {
            setCurrentFolderId(null);
        }
    }
  };
  
  // Handler para abrir o modal de criação
  const handleCreateItemRequest = (type) => {
    setCreationType(type);
    setShowCreationModal(true);
  };

  // Handler para executar a criação no Firebase (chamado pelo Modal)
  const handleCreateItemSubmit = async (name) => {
    if (!name || name.trim() === '') {
        console.log("Criação cancelada ou nome vazio.");
        return;
    }

    const type = creationType;
    name = name.trim();
    
    try {
      console.log(`Tentando criar ${type}: ${name} na pasta pai: ${currentFolderId || 'Raiz'}`);
      
      const newItem = {
        name,
        type,
        parent: currentFolderId, 
        content: type === 'document' ? '' : null,
        createdAt: Date.now(),
        createdBy: user.uid,
      };
      
      const docRef = await addDoc(roomFilesColRef, newItem);
      console.log(`${type} criado com sucesso. ID: ${docRef.id}`);
      
      if (type === 'document') {
           setCurrentFileId(docRef.id);
      }

    } catch (e) {
      console.error("ERRO CRÍTICO ao criar item:", e);
    } finally {
        setShowCreationModal(false);
        setCreationType(null);
    }
  };
  
  // Handler para iniciar a renomeação
  const handleRenameItemRequest = (item) => {
    setShowRenameModal({
        item: item,
        onRename: async (newName) => {
            if (newName && newName.trim() !== item.name) {
                try {
                    await setDoc(doc(roomFilesColRef, item.id), { name: newName.trim() }, { merge: true });
                } catch (e) {
                    console.error("Erro ao renomear:", e);
                }
            }
            setShowRenameModal(null);
        }
    });
  };

  // Handler para iniciar a exclusão
  const handleDeleteItemRequest = (itemId, name) => {
    // 1. Verifica se é pasta e se tem filhos
    const isFolder = allItems.find(i => i.id === itemId)?.type === 'folder';
    if (isFolder && allItems.some(i => i.parent === itemId)) {
        setShowConfirmModal({
            message: `Não é possível deletar a pasta "${name}". Ela deve estar vazia.`,
            onConfirm: () => setShowConfirmModal(null), // Apenas fecha
            isError: true,
        });
        return;
    }

    setShowConfirmModal({
        message: `Tem certeza que deseja deletar "${name}"?`,
        onConfirm: () => deleteItem(itemId),
    });
  };

  // Handler para executar a exclusão no Firebase
  const deleteItem = async (itemId) => {
    try {
        await deleteDoc(doc(roomFilesColRef, itemId));
        if (itemId === currentFileId) {
            setCurrentFileId(null); 
        }
    } catch (e) {
        console.error("Erro ao deletar item:", e);
    } finally {
        setShowConfirmModal(null);
    }
  };
  
  // 6. Upload de Imagem
  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const base64Image = await compressImage(file);
      
      await addDoc(imagesColRef, {
        url: base64Image,
        name: file.name,
        uploadedBy: user.uid,
        createdAt: Date.now()
      });
      
    } catch (err) {
      console.error("Erro upload:", err);
    } finally {
      setUploading(false);
      e.target.value = null;
    }
  };
  
  // Handler para iniciar a exclusão de imagem
  const handleDeleteImageRequest = (imgObj) => {
    setShowConfirmModal({
        message: "Tem certeza que deseja excluir esta imagem?",
        onConfirm: () => deleteImage(imgObj),
    });
  };

  // Handler para executar a exclusão de imagem no Firebase
  const deleteImage = async (imgObj) => {
    try {
      const imgDocRef = doc(db, 'artifacts', appId, 'public', 'data', `sharepad_images_${slug}`, imgObj.id);
      await deleteDoc(imgDocRef);
    } catch (err) {
      console.error("Erro ao deletar:", err);
    } finally {
        setShowConfirmModal(null);
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(slug);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // --- Renderização do Conteúdo Principal ---
  const currentFile = allItems.find(item => item.id === currentFileId);
  
  const mainContent = currentFileId ? (
    // MODO EDITOR DE TEXTO
    <div className="flex flex-col h-full">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-white flex-shrink-0">
            <button onClick={goBack} className="p-1 hover:bg-gray-100 rounded-full text-gray-500 flex items-center gap-1">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
                </svg>
                <span className="text-sm font-medium">Voltar</span>
            </button>
            <h3 className="font-semibold text-gray-800 truncate flex-1 text-center pr-12">
                {currentFile?.name || 'Documento'}
            </h3>
        </div>
        <textarea
            ref={textareaRef}
            value={text}
            onChange={handleTextChange}
            placeholder="Digite aqui..."
            className="w-full flex-1 p-6 resize-none outline-none font-mono text-gray-800 text-base leading-relaxed overflow-y-auto"
            spellCheck={false}
        />
    </div>
  ) : (
    // MODO NAVEGADOR DE ARQUIVOS/PASTAS
    <FileBrowser 
        content={folderContent}
        currentFolderId={currentFolderId}
        currentFolderName={currentFolderName}
        onNavigate={navigateToFolder}
        onOpenFile={openDocument}
        onCreateItem={handleCreateItemRequest}
        onGoBack={goBack}
        onRename={handleRenameItemRequest}
        onDelete={handleDeleteItemRequest}
    />
  );

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-white">
      
      {/* Modals */}
      {showCreationModal && (
        <CreationModal 
            type={creationType} 
            onClose={() => setShowCreationModal(false)}
            onSubmit={handleCreateItemSubmit}
        />
      )}
      
      {showConfirmModal && (
        <ConfirmationModal 
            message={showConfirmModal.message}
            onConfirm={showConfirmModal.onConfirm}
            onCancel={() => setShowConfirmModal(null)}
            isError={showConfirmModal.isError}
        />
      )}
      
      {showRenameModal && (
        <RenameModal 
            item={showRenameModal.item}
            onClose={() => setShowRenameModal(null)}
            onRename={showRenameModal.onRename}
        />
      )}

      {/* Header */}
      <header className="h-14 border-b border-gray-200 flex items-center justify-between px-4 bg-white flex-shrink-0 z-10">
        <div className="flex items-center gap-3 overflow-hidden">
          {/* O botão de voltar para a sala não aparece se estivermos em um arquivo */}
          {!currentFileId && (
            <button onClick={onExit} className="p-1 hover:bg-gray-100 rounded-full text-gray-500">
                <X className="w-5 h-5" />
            </button>
          )}
          <div className="flex flex-col">
            <h2 className="font-bold text-gray-800 flex items-center gap-2 text-lg leading-tight">
              /{slug} 
              <button onClick={copyLink} className="text-gray-400 hover:text-blue-600 transition-colors" title="Copiar nome">
                {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
              </button>
            </h2>
            <span className="text-xs text-gray-400">{status}</span>
          </div>
        </div>

        <button 
          className="md:hidden p-2 text-gray-600 hover:bg-gray-100 rounded-lg relative"
          onClick={() => setShowSidebar(!showSidebar)}
        >
          <ImageIcon className="w-5 h-5" />
          {images.length > 0 && (
            <span className="absolute top-1 right-1 w-2 h-2 bg-blue-500 rounded-full"></span>
          )}
        </button>
      </header>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Editor OU Navegador de Arquivos (Esquerda) */}
        <div className="flex-1 flex flex-col relative h-full">
          {mainContent}
        </div>

        {/* Galeria Infinita (Direita) */}
        <div className={`
          absolute md:relative z-20 top-0 right-0 h-full bg-gray-50 border-l border-gray-200 w-full md:w-80 lg:w-96 transform transition-transform duration-300 ease-in-out flex flex-col
          ${showSidebar ? 'translate-x-0' : 'translate-x-full md:translate-x-0'}
        `}>
          <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-white md:bg-gray-50">
            <h3 className="font-semibold text-gray-700 flex items-center gap-2">
              <ImageIcon className="w-4 h-4" /> Galeria ({images.length})
            </h3>
            <button onClick={() => setShowSidebar(false)} className="md:hidden p-1">
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {images.length === 0 && (
              <div className="text-center text-gray-400 py-10">
                <Upload className="w-12 h-12 mx-auto mb-2 opacity-20" />
                <p className="text-sm">Sem fotos.</p>
              </div>
            )}
            
            {images.map((img) => (
              <div key={img.id} className="group relative bg-white p-2 rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
                <div className="aspect-video w-full bg-gray-100 rounded overflow-hidden relative mb-2">
                   {/* Fallback image to prevent FOUC */}
                   <img 
                      src={img.url} 
                      alt="Upload" 
                      className="w-full h-full object-contain" 
                      onError={(e) => {
                          e.target.onerror = null; 
                          e.target.src = `https://placehold.co/800x450/cccccc/333333?text=Imagem+indisponível`;
                      }}
                   />
                </div>
                <div className="flex items-center justify-between text-xs text-gray-500 px-1">
                  <span className="truncate max-w-[150px]">
                    {safeFormatTime(img.createdAt)}
                  </span>
                  <div className="flex gap-2">
                     <a href={img.url} download={`sharepad-${img.id}.jpg`} className="hover:text-blue-600 p-1">
                       <Download className="w-4 h-4" />
                     </a>
                     <button onClick={() => handleDeleteImageRequest(img)} className="hover:text-red-600 p-1">
                       <Trash2 className="w-4 h-4" />
                     </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="p-4 border-t border-gray-200 bg-white">
            <label className={`
              flex flex-col items-center justify-center w-full h-24 border-2 border-dashed rounded-lg cursor-pointer transition-colors
              ${uploading ? 'bg-gray-100 border-gray-300 cursor-not-allowed' : 'border-blue-300 bg-blue-50 hover:bg-blue-100 text-blue-600'}
            `}>
              {uploading ? (
                <div className="flex flex-col items-center gap-2 text-gray-500">
                  <Loader2 className="w-6 h-6 animate-spin" />
                  <span className="text-xs font-medium">Enviando...</span>
                </div>
              ) : (
                <>
                  <Upload className="w-6 h-6 mb-1" />
                  <span className="text-xs font-semibold">Adicionar Foto</span>
                  <span className="text-[10px] text-blue-400 mt-1">Ilimitado (1MB máx cada)</span>
                </>
              )}
              <input 
                type="file" 
                className="hidden" 
                accept="image/*"
                onChange={handleImageUpload}
                disabled={uploading}
              />
            </label>
          </div>
        </div>

        {showSidebar && (
          <div 
            className="absolute inset-0 bg-black/20 z-10 md:hidden"
            onClick={() => setShowSidebar(false)}
          ></div>
        )}
      </div>
    </div>
  );
}

// --- Componente do Navegador de Arquivos ---
function FileBrowser({ content, currentFolderId, currentFolderName, onNavigate, onOpenFile, onCreateItem, onGoBack, onRename, onDelete }) {
    
    // Icone de três pontos para menu de contexto
    const ThreeDots = () => (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM12.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM18.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
        </svg>
    );
    
    // Icones para Pasta e Documento (Usando SVGs para evitar dependências)
    const FolderIcon = (props) => (
        <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-yellow-500" viewBox="0 0 24 24" fill="currentColor" {...props}>
            <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
        </svg>
    );

    const DocumentIcon = (props) => (
        <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-blue-600" viewBox="0 0 24 24" fill="currentColor" {...props}>
            <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.89 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v4h4v12H6z"/>
        </svg>
    );
    
    const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, itemId: null, itemType: null, itemName: '', item: null });

    const handleContextMenu = (e, item) => {
        e.preventDefault();
        setContextMenu({
            visible: true,
            x: e.clientX,
            y: e.clientY,
            itemId: item.id,
            itemType: item.type,
            itemName: item.name,
            item: item,
        });
    };

    const closeContextMenu = () => {
        setContextMenu({ visible: false, x: 0, y: 0, itemId: null, itemType: null, itemName: '', item: null });
    };

    // Fechar menu de contexto ao clicar fora
    useEffect(() => {
        const handleClickOutside = () => closeContextMenu();
        if (contextMenu.visible) {
            document.addEventListener('click', handleClickOutside);
        }
        return () => document.removeEventListener('click', handleClickOutside);
    }, [contextMenu.visible]);
    
    const handleRenameClick = () => {
        onRename(contextMenu.item);
        closeContextMenu();
    };

    const handleDeleteClick = () => {
        onDelete(contextMenu.itemId, contextMenu.itemName);
        closeContextMenu();
    };

    return (
        <div className="h-full flex flex-col p-6 bg-gray-50">
            {/* Header de Navegação */}
            <div className="flex items-center space-x-2 mb-4 p-3 bg-white border border-gray-200 rounded-xl shadow-md">
                <button 
                    onClick={onGoBack} 
                    disabled={!currentFolderId && !currentFolderName !== 'Raiz'} 
                    className="p-1 rounded-full hover:bg-gray-100 transition disabled:opacity-50"
                    title="Voltar"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
                    </svg>
                </button>
                <span className="font-bold text-gray-800 truncate">
                    {currentFolderName}
                </span>
            </div>

            {/* Ações */}
            <div className="flex space-x-3 mb-6 flex-shrink-0">
                <button
                    onClick={() => onCreateItem('document')}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition shadow-lg shadow-blue-500/30"
                >
                    <DocumentIcon className="w-4 h-4 text-white" />
                    Novo Doc
                </button>
                <button
                    onClick={() => onCreateItem('folder')}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm bg-gray-200 text-gray-700 rounded-xl hover:bg-gray-300 transition shadow-lg shadow-gray-300/30"
                >
                    <FolderIcon className="w-4 h-4 text-yellow-600" />
                    Nova Pasta
                </button>
            </div>

            {/* Lista de Conteúdo */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                {content.length === 0 ? (
                    <div className="text-center text-gray-400 py-10 border-2 border-dashed border-gray-200 rounded-xl bg-white/50 m-4">
                        <FolderIcon className="w-12 h-12 mx-auto mb-2 opacity-20" />
                        <p className="text-sm">Esta pasta está vazia. Crie um novo documento ou pasta.</p>
                    </div>
                ) : (
                    content.map((item) => (
                        <div
                            key={item.id}
                            className="flex items-center justify-between p-3 bg-white rounded-xl shadow-sm hover:bg-blue-50 hover:shadow-md transition cursor-pointer group"
                            onClick={() => item.type === 'folder' ? onNavigate(item.id) : onOpenFile(item.id)}
                            onContextMenu={(e) => handleContextMenu(e, item)}
                        >
                            <div className="flex items-center space-x-3 truncate">
                                {item.type === 'folder' ? <FolderIcon /> : <DocumentIcon />}
                                <span className="truncate text-base text-gray-800 font-medium">{item.name}</span>
                            </div>
                            <button
                                onClick={(e) => { e.stopPropagation(); handleContextMenu(e, item); }}
                                className="p-1 rounded-full text-gray-400 hover:bg-gray-200 hover:text-gray-700 opacity-0 group-hover:opacity-100 transition"
                                title="Opções"
                            >
                                <ThreeDots />
                            </button>
                        </div>
                    ))
                )}
            </div>
            
            {/* Menu de Contexto Flutuante */}
            {contextMenu.visible && (
                <div
                    className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-xl py-1 text-sm text-gray-700 w-32"
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <button 
                        onClick={handleRenameClick} 
                        className="flex items-center w-full px-4 py-2 hover:bg-gray-100"
                    >
                        Renomear
                    </button>
                    <button 
                        onClick={handleDeleteClick} 
                        className="flex items-center w-full px-4 py-2 hover:bg-red-50 text-red-600"
                    >
                        Deletar
                    </button>
                </div>
            )}
        </div>
    );
}

// --- Componentes de Modal Customizados ---

function Modal({ children, onClose }) {
    return (
        <div 
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={onClose}
        >
            <div 
                className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {children}
            </div>
        </div>
    );
}

// Modal de Criação de Arquivo/Pasta
function CreationModal({ type, onClose, onSubmit }) {
    const [name, setName] = useState('');
    const title = type === 'folder' ? 'Criar Nova Pasta' : 'Criar Novo Documento';
    const Icon = type === 'folder' ? FolderIconLucide : FileText;

    const handleSubmit = (e) => {
        e.preventDefault();
        onSubmit(name);
    };

    return (
        <Modal onClose={onClose}>
            <div className="p-6">
                <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <Icon className="w-6 h-6 text-blue-600" /> {title}
                </h3>
                <form onSubmit={handleSubmit}>
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Nome do Item"
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
                        autoFocus
                    />
                    <div className="flex justify-end space-x-3 mt-6">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-sm font-semibold text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={!name.trim()}
                            className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
                        >
                            Criar
                        </button>
                    </div>
                </form>
            </div>
        </Modal>
    );
}

// Modal de Confirmação (para Deletar e avisos de Pasta Vazia)
function ConfirmationModal({ message, onConfirm, onCancel, isError = false }) {
    const Icon = isError ? X : Trash2;
    const color = isError ? 'text-red-600' : 'text-yellow-600';
    const buttonClass = isError ? 'bg-blue-600 hover:bg-blue-700' : 'bg-red-600 hover:bg-red-700';
    const confirmText = isError ? 'Fechar' : 'Confirmar';

    const handleConfirm = () => {
        onConfirm();
    };

    return (
        <Modal onClose={isError ? onConfirm : onCancel}>
            <div className="p-6 text-center">
                <div className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 ${color} mb-4`}>
                    <Icon className="w-6 h-6" />
                </div>
                <p className="text-base text-gray-700">{message}</p>
                <div className="mt-6 flex justify-center space-x-3">
                    {!isError && (
                        <button
                            onClick={onCancel}
                            className="px-4 py-2 text-sm font-semibold text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition"
                        >
                            Cancelar
                        </button>
                    )}
                    <button
                        onClick={handleConfirm}
                        className={`px-4 py-2 text-sm font-semibold text-white rounded-lg transition ${buttonClass}`}
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </Modal>
    );
}

// Modal de Renomeação
function RenameModal({ item, onClose, onRename }) {
    const [newName, setNewName] = useState(item.name);
    const Icon = item.type === 'folder' ? FolderIconLucide : FileText;

    const handleSubmit = (e) => {
        e.preventDefault();
        onRename(newName);
    };

    return (
        <Modal onClose={onClose}>
            <div className="p-6">
                <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <Icon className="w-6 h-6 text-blue-600" /> Renomear {item.type === 'folder' ? 'Pasta' : 'Documento'}
                </h3>
                <form onSubmit={handleSubmit}>
                    <input
                        type="text"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
                        autoFocus
                    />
                    <div className="flex justify-end space-x-3 mt-6">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-sm font-semibold text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={!newName.trim() || newName.trim() === item.name}
                            className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
                        >
                            Salvar
                        </button>
                    </div>
                </form>
            </div>
        </Modal>
    );
}
