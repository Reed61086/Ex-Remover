
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { editImage, identifyPersonAt, isPersonInImage } from './services/geminiService';
import { fileToBase64 } from './utils/fileUtils';

// --- TYPE DEFINITIONS ---
declare var JSZip: any;
declare var saveAs: any;

type ImageStatus = 'queued' | 'verifying' | 'processing' | 'person_not_found' | 'done' | 'failed';
type AppStep = 'upload' | 'target' | 'processing';

type ImageState = {
  id: string;
  file: File;
  originalUrl: string;
  processedUrl: string | null;
  status: ImageStatus;
  error?: string;
};

// --- HELPER FUNCTIONS ---
const dataURLtoBlob = (dataurl: string): Blob | null => {
    const arr = dataurl.split(',');
    if (arr.length < 2) return null;
    const mimeMatch = arr[0].match(/:(.*?);/);
    if (!mimeMatch) return null;
    const mime = mimeMatch[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while(n--){
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], {type:mime});
}

const createRemovalPrompt = (description: string): string => {
    return `Initiate a Key Inpainting and Editing (KIE) operation. The target for removal is defined by the following detailed facial and head structure description: "${description}". Execute a complete inpainting of the area occupied by this person. Your primary task is to reconstruct the background with photorealistic detail, ensuring seamless integration with the surrounding environment. The final image must be free of any artifacts, distortions, or remnants of the removed person, appearing as if they were never there.`;
};

const trackInfluencerCredit = (id: string) => {
    if (!id) return;
    try {
        const data = localStorage.getItem('influencerData');
        const influencers = data ? JSON.parse(data) : {};
        const currentData = influencers[id] || { photosProcessed: 0 };
        currentData.photosProcessed += 1;
        influencers[id] = {
            photosProcessed: currentData.photosProcessed,
            payout: (currentData.photosProcessed * 0.02).toFixed(2)
        };
        localStorage.setItem('influencerData', JSON.stringify(influencers));
        console.log(`Credited influencer ${id}. New data:`, influencers[id]);
    } catch (e) {
        console.error("Failed to track influencer credit:", e);
    }
};


// --- ICONS ---
const UploadIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
  </svg>
);

const RemoveIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
    </svg>
);

const DownloadIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
    </svg>
);

const CreditIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-2 text-yellow-300" viewBox="0 0 20 20" fill="currentColor">
        <path d="M8.433 7.418c.158-.103.346-.196.567-.267v1.698a2.5 2.5 0 00-1.134 0V7.418zM10 16a6 6 0 100-12 6 6 0 000 12zm-3.53-8.418a2.501 2.501 0 00-1.135 4.143 4.5 4.5 0 011.135-4.143zM10 4.5c.53 0 1.024.113 1.47.318a4.5 4.5 0 01-2.94 0A4.526 4.526 0 0110 4.5zM13.53 7.582a4.5 4.5 0 011.135 4.143 2.501 2.501 0 00-1.135-4.143zM9 11.567V9.87c.158.07.346.164.567.267a2.5 2.5 0 001.134 0c.22-.103.408-.196.567-.267v1.698a2.501 2.501 0 00-2.268 0z" />
    </svg>
);

const CloseIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
);

const Spinner = ({ size = '8' }: { size?: string }) => (
    <div className={`animate-spin rounded-full h-${size} w-${size} border-t-2 border-b-2 border-white`}></div>
);

const ErrorMessageWithLinks = ({ message }: { message: string }) => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = message.split(urlRegex);

    return (
        <p className="text-xs text-red-300 text-center break-words mt-2">
            {parts.map((part, index) => {
                if (part.match(urlRegex)) {
                    let url = part;
                    let punctuation = '';
                    if (/[.,!?]/.test(url.slice(-1))) {
                        punctuation = url.slice(-1);
                        url = url.slice(0, -1);
                    }
                    return (
                        <React.Fragment key={index}>
                            <a href={url} target="_blank" rel="noopener noreferrer" className="underline hover:text-red-200">
                                {url}
                            </a>
                            {punctuation}
                        </React.Fragment>
                    );
                }
                return part;
            })}
        </p>
    );
};


// --- MAIN APP COMPONENT ---
const App: React.FC = () => {
    const [step, setStep] = useState<AppStep>('upload');
    const [images, setImages] = useState<ImageState[]>([]);
    const [targetDescription, setTargetDescription] = useState<string>("");
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState<boolean>(false);
    const [isIdentifying, setIsIdentifying] = useState<boolean>(false);
    const [isDownloading, setIsDownloading] = useState<boolean>(false);
    const [credits, setCredits] = useState<number>(3);
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState<boolean>(false);
    const [isIOS, setIsIOS] = useState<boolean>(false);
    const [retryingImageId, setRetryingImageId] = useState<string | null>(null);
    const [influencerId, setInfluencerId] = useState<string>('');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const processedImageIds = useRef(new Set<string>());
    
    useEffect(() => {
        setIsIOS(/iPad|iPhone|iPod/.test(navigator.userAgent));
    }, []);

    useEffect(() => {
        try {
            const bonusApplied = localStorage.getItem('oneTimeCreditBonusApplied');
            let currentCredits = 3; // Default
            
            const savedCredits = localStorage.getItem('exRemoverCredits');
            if (savedCredits !== null) {
                const parsedCredits = parseInt(savedCredits, 10);
                if (!isNaN(parsedCredits) && parsedCredits >= 0) {
                    currentCredits = parsedCredits;
                }
            }

            if (!bonusApplied) {
                const newTotal = currentCredits + 3;
                setCredits(newTotal);
                localStorage.setItem('exRemoverCredits', newTotal.toString());
                localStorage.setItem('oneTimeCreditBonusApplied', 'true');
            } else {
                setCredits(currentCredits);
                 // Ensure localStorage is consistent if it was invalid before
                localStorage.setItem('exRemoverCredits', currentCredits.toString());
            }
        } catch (error) {
            console.error('Failed to initialize credits from localStorage:', error);
            setCredits(3); // Fallback to default in case of any error
        }
    }, []);

    useEffect(() => {
        try {
            if (!isNaN(credits) && credits >= 0) {
                localStorage.setItem('exRemoverCredits', credits.toString());
            }
        } catch (error) {
            console.error('Failed to save credits to localStorage:', error);
        }
    }, [credits]);
    
    useEffect(() => {
        try {
            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.get('payment_success') === 'true') {
                const pendingCredits = localStorage.getItem('pendingPurchase');
                if (pendingCredits) {
                    localStorage.removeItem('pendingPurchase');
                    const purchasedAmount = parseInt(pendingCredits, 10);
                    if (!isNaN(purchasedAmount) && purchasedAmount > 0) {
                        setCredits(prev => prev + purchasedAmount);
                        setSuccessMessage(`${purchasedAmount} credits added successfully!`);
                        setTimeout(() => setSuccessMessage(null), 5000);
                    }
                    if (window.history && window.history.replaceState) {
                       window.history.replaceState({}, document.title, window.location.pathname);
                    }
                }
            }
        } catch (error) {
            console.error('Error processing payment success status:', error);
        }
    }, []);

    useEffect(() => {
        const objectUrls = images.map(img => img.originalUrl);
        return () => {
            objectUrls.forEach(url => URL.revokeObjectURL(url));
        };
    }, [images]);

    useEffect(() => {
        images.forEach(image => {
            if (image.status === 'done' && !processedImageIds.current.has(image.id)) {
                processedImageIds.current.add(image.id);
                trackInfluencerCredit(influencerId);
            }
        });
    }, [images, influencerId]);
    
    const resetState = () => {
        setStep('upload');
        setImages([]);
        setTargetDescription("");
        setError(null);
        setIsIdentifying(false);
        setIsDownloading(false);
        setRetryingImageId(null);
        setInfluencerId('');
        processedImageIds.current.clear();
        if (fileInputRef.current) {
            fileInputRef.current.value = "";
        }
    };

    const handleFileChange = (files: FileList | null) => {
        if (!files || files.length === 0) return;

        const acceptedFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
        if (acceptedFiles.length !== files.length) {
            setError("Some files were not valid image types and were ignored.");
        }
        if (acceptedFiles.length === 0) return;
        
        // Reset everything except influencerId when new files are added
        setImages([]);
        setTargetDescription("");
        setError(null);
        setStep('upload');
        processedImageIds.current.clear();

        const newImageStates: ImageState[] = acceptedFiles.map(file => ({
            id: `${file.name}-${file.lastModified}`,
            file,
            originalUrl: URL.createObjectURL(file),
            processedUrl: null,
            status: 'queued',
        }));
        setImages(newImageStates);
    };

    const handleDragEvents = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "dragenter" || e.type === "dragover") setIsDragging(true);
        else if (e.type === "dragleave") setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        handleFileChange(e.dataTransfer.files);
    };

    const handleImageClick = async (e: React.MouseEvent<HTMLImageElement>) => {
        if (isIdentifying || !images[0]) return;

        const img = e.currentTarget;
        const naturalX = Math.round((e.nativeEvent.offsetX / img.clientWidth) * img.naturalWidth);
        const naturalY = Math.round((e.nativeEvent.offsetY / img.clientHeight) * img.naturalHeight);

        setIsIdentifying(true);
        setError(null);
        setTargetDescription("");

        try {
            const base64Data = await fileToBase64(images[0].file);
            const description = await identifyPersonAt(base64Data, images[0].file.type, naturalX, naturalY);
            setTargetDescription(description);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to identify person.");
        } finally {
            setIsIdentifying(false);
        }
    };
    
    const startProcessing = useCallback(async () => {
        if (!targetDescription.trim()) {
            setError("Please select a person to remove by clicking on them in the photo.");
            return;
        }

        if (images.length > credits) {
            setError(`You need ${images.length} credit(s) for this job, but you only have ${credits}. Please buy more.`);
            setIsPaymentModalOpen(true);
            return;
        }
        
        setCredits(prev => prev - images.length);
        setStep('processing');
        setError(null);
        
        for (const image of images) {
            setImages(prev => prev.map(img => img.id === image.id ? { ...img, status: 'verifying' } : img));
            try {
                const base64Data = await fileToBase64(image.file);
                const personPresent = await isPersonInImage(base64Data, image.file.type, targetDescription);
                
                if (personPresent) {
                    setImages(prev => prev.map(img => img.id === image.id ? { ...img, status: 'processing' } : img));
                    const fullPrompt = createRemovalPrompt(targetDescription);
                    const resultUrl = await editImage(base64Data, image.file.type, fullPrompt);
                    setImages(prev => prev.map(img => img.id === image.id ? { ...img, status: 'done', processedUrl: resultUrl } : img));
                } else {
                    setImages(prev => prev.map(img => img.id === image.id ? { ...img, status: 'person_not_found' } : img));
                }
            } catch (e) {
                const errorMessage = e instanceof Error ? e.message : "An unexpected error occurred.";
                if (errorMessage.includes('billing') || errorMessage.includes('quota')) {
                    setCredits(prev => prev + 1); // Refund credit on billing/quota failure
                }
                setImages(prev => prev.map(img => img.id === image.id ? { ...img, status: 'failed', error: errorMessage } : img));
            }
        }
    }, [images, targetDescription, credits]);

    const handlePersonNotInPhoto = (imageId: string) => {
        setImages(prev => prev.map(img => 
            img.id === imageId 
                ? { ...img, status: 'done', processedUrl: img.originalUrl } 
                : img
        ));
        setCredits(prev => prev + 1);
    };

    const handleRetryIdentification = (imageId: string) => {
        setRetryingImageId(imageId);
    };

    const handleStartReverify = (imageId: string) => {
        if (credits < 1) {
            setError("You need 1 credit to fix this image. Please buy more.");
            setIsPaymentModalOpen(true);
            return;
        }
        setCredits(prev => prev - 1);
        setRetryingImageId(imageId);
    };

    const handleRetryImageClick = async (e: React.MouseEvent<HTMLImageElement>, image: ImageState) => {
        if (retryingImageId !== image.id) return;

        const img = e.currentTarget;
        const naturalX = Math.round((e.nativeEvent.offsetX / img.clientWidth) * img.naturalWidth);
        const naturalY = Math.round((e.nativeEvent.offsetY / img.clientHeight) * img.naturalHeight);
        
        setImages(prev => prev.map(i => i.id === image.id ? { ...i, status: 'processing' } : i));
        setRetryingImageId(null);

        try {
            const base64Data = await fileToBase64(image.file);
            const specificDescription = await identifyPersonAt(base64Data, image.file.type, naturalX, naturalY);
            
            const promptForThisImage = createRemovalPrompt(specificDescription);
            const resultUrl = await editImage(base64Data, image.file.type, promptForThisImage);
            setImages(prev => prev.map(i => i.id === image.id ? { ...i, status: 'done', processedUrl: resultUrl } : i));

            const newAugmentedDescription = `${targetDescription}\n\n[Additional detail from another photo]: ${specificDescription}`;
            setTargetDescription(newAugmentedDescription);

            setImages(currentImages => {
                const imagesToReverify = currentImages.filter(img => img.status === 'person_not_found');
                
                const reverify = async () => {
                    for (const imageToReverify of imagesToReverify) {
                        setImages(prev => prev.map(img => img.id === imageToReverify.id ? { ...img, status: 'verifying' } : img));
                        try {
                            const reverifyBase64 = await fileToBase64(imageToReverify.file);
                            const personPresent = await isPersonInImage(reverifyBase64, imageToReverify.file.type, newAugmentedDescription);
                            
                            if (personPresent) {
                                setImages(prev => prev.map(img => img.id === imageToReverify.id ? { ...img, status: 'processing' } : img));
                                const removalPrompt = createRemovalPrompt(newAugmentedDescription);
                                const reverifyResultUrl = await editImage(reverifyBase64, imageToReverify.file.type, removalPrompt);
                                setImages(prev => prev.map(img => img.id === imageToReverify.id ? { ...img, status: 'done', processedUrl: reverifyResultUrl } : img));
                            } else {
                                setImages(prev => prev.map(img => img.id === imageToReverify.id ? { ...img, status: 'person_not_found' } : img));
                            }
                        } catch (err) {
                            const errorMessage = err instanceof Error ? err.message : "An unexpected error occurred.";
                            if (errorMessage.includes('billing') || errorMessage.includes('quota')) {
                                setCredits(prev => prev + 1); // Refund credit on billing/quota failure
                            }
                            setImages(prev => prev.map(img => img.id === imageToReverify.id ? { ...img, status: 'failed', error: errorMessage } : img));
                        }
                    }
                };
                
                reverify();
                return currentImages;
            });

        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : "An unexpected error occurred.";
            if (errorMessage.includes('billing') || errorMessage.includes('quota')) {
                setCredits(prev => prev + 1); // Refund credit
            }
            setImages(prev => prev.map(i => i.id === image.id ? { ...i, status: 'failed', error: errorMessage } : i));
        }
    };


     const handleDownloadAll = async () => {
        const successfulImages = images.filter(img => img.status === 'done' && img.processedUrl);
        if (successfulImages.length === 0) {
            setError("No images have been successfully processed to download.");
            return;
        }

        setIsDownloading(true);
        setError(null);

        try {
            const zip = new JSZip();
            for (const image of successfulImages) {
                const blob = dataURLtoBlob(image.processedUrl!);
                if (blob) {
                    zip.file(image.file.name, blob);
                }
            }
            const content = await zip.generateAsync({ type: "blob" });
            saveAs(content, "ex-remover-results.zip");
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to create zip file.");
        } finally {
            setIsDownloading(false);
        }
    };

    const StepIndicator = () => {
        const steps = ['Upload Photos', 'Select Person', 'View Results'];
        const currentStepIndex = step === 'upload' ? 0 : step === 'target' ? 1 : 2;

        return (
            <div className="flex justify-center items-center w-full max-w-2xl mx-auto space-x-2 sm:space-x-4 mb-8">
                {steps.map((stepName, index) => (
                    <React.Fragment key={index}>
                        <div className="flex items-center flex-col sm:flex-row text-center">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-lg transition-all duration-300 ${index <= currentStepIndex ? 'bg-brand-primary text-white' : 'bg-base-300 text-text-secondary'}`}>
                                {index + 1}
                            </div>
                            <p className={`mt-2 sm:mt-0 sm:ml-3 font-semibold text-sm transition-colors duration-300 ${index <= currentStepIndex ? 'text-text-primary' : 'text-text-secondary'}`}>
                                {stepName}
                            </p>
                        </div>
                        {index < steps.length - 1 && (
                            <div className={`flex-1 h-1 rounded-full transition-all duration-500 ${index < currentStepIndex ? 'bg-brand-primary' : 'bg-base-300'}`}></div>
                        )}
                    </React.Fragment>
                ))}
            </div>
        );
    };

    const renderUploadStep = () => (
        <div className="bg-base-200 p-6 rounded-2xl shadow-lg flex flex-col items-center space-y-6">
            <h2 className="text-2xl font-bold">Upload Your Photos</h2>
            <div 
                className={`w-full relative border-2 border-dashed rounded-xl p-6 text-center transition-all duration-300 ${isDragging ? 'border-brand-primary bg-brand-primary/20 glow-border' : 'border-base-300'}`}
                onDragEnter={handleDragEvents} onDragOver={handleDragEvents} onDragLeave={handleDragEvents} onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
            >
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" multiple onChange={(e) => handleFileChange(e.target.files)} />
                <div className="flex flex-col items-center justify-center space-y-2 cursor-pointer">
                    <UploadIcon />
                    <p className="font-semibold text-text-primary">Drag & Drop photos here</p>
                    <p className="text-sm text-text-secondary">or click to select files</p>
                    {isIOS && (
                        <p className="text-xs text-text-secondary mt-4 bg-base-300 p-2 rounded-md text-left">
                            <strong>iOS Tip:</strong> To select multiple photos, tap "Select" in your photo library, then slide your finger across the images you want to upload.
                        </p>
                    )}
                </div>
            </div>

            <div className="w-full">
                <label htmlFor="influencerId" className="block text-sm font-medium text-text-secondary mb-2">
                    Influencer Code (Optional)
                </label>
                <input
                    type="text"
                    id="influencerId"
                    value={influencerId}
                    onChange={(e) => setInfluencerId(e.target.value.trim().toUpperCase())}
                    placeholder="Enter code here"
                    className="w-full bg-base-300 border border-base-300 rounded-lg p-3 focus:ring-2 focus:ring-brand-primary focus:border-transparent transition duration-200 placeholder-text-secondary/60"
                />
            </div>

            {images.length > 0 && (
                <>
                    <p className="text-text-secondary">{images.length} image{images.length > 1 ? 's' : ''} selected. (1 Credit per image)</p>
                     <div className="w-full grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                        {images.slice(0, 12).map((img, index) => (
                            <img key={img.id} src={img.originalUrl} alt={`preview ${index}`} className="w-full h-20 object-cover rounded-md shadow-sm" />
                        ))}
                    </div>
                    <button onClick={() => setStep('target')} className="w-full btn-primary text-white font-bold py-3 px-4 rounded-lg">
                        Next: Select Person
                    </button>
                </>
            )}
        </div>
    );

    const renderTargetStep = () => (
        <div className="bg-base-200 p-6 rounded-2xl shadow-lg flex flex-col space-y-6">
            <h2 className="text-2xl font-bold">Select the Person to Remove</h2>
            <p className="text-text-secondary text-sm">Click on the person in the photo below. Our AI will identify them for removal from all photos.</p>
            <div className="flex flex-col md:flex-row gap-4">
                <div className="w-full md:w-1/2 relative">
                    <img 
                        src={images[0]?.originalUrl} 
                        alt="Reference" 
                        className={`w-full h-auto max-h-[400px] object-contain rounded-lg bg-base-300 p-1 ring-2 ring-base-300 transition-all duration-300 ${isIdentifying ? 'opacity-50' : 'cursor-crosshair hover:ring-brand-primary hover:shadow-2xl'}`}
                        onClick={handleImageClick}
                    />
                    {isIdentifying && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm rounded-lg">
                            <Spinner />
                            <p className="text-white mt-2 font-semibold">Identifying...</p>
                        </div>
                    )}
                </div>
                <div className="w-full md:w-1/2 flex flex-col">
                    <label htmlFor="prompt" className="block text-sm font-medium text-text-secondary mb-2">
                        AI Generated Description
                    </label>
                    <textarea
                        id="prompt"
                        value={targetDescription}
                        onChange={(e) => setTargetDescription(e.target.value)}
                        placeholder="Click on a person in the photo to auto-generate a description here..."
                        className="flex-grow w-full bg-base-300 border border-base-300 rounded-lg p-3 focus:ring-2 focus:ring-brand-primary focus:border-transparent transition duration-200 resize-none placeholder-text-secondary/60"
                        rows={5}
                    />
                </div>
            </div>
            <button onClick={startProcessing} disabled={!targetDescription.trim() || isIdentifying} className="w-full flex items-center justify-center btn-primary text-white font-bold py-3 px-4 rounded-lg disabled:bg-none disabled:bg-base-300 disabled:text-gray-500 disabled:cursor-not-allowed">
                <RemoveIcon />
                {`Start Removing (${images.length} Credit${images.length > 1 ? 's' : ''})`}
            </button>
        </div>
    );
    
    const renderProcessingStep = () => (
        <div className="bg-base-200 p-6 rounded-2xl shadow-lg">
            <div className="flex flex-wrap gap-2 justify-between items-center mb-4">
                <h2 className="text-2xl font-bold">Results</h2>
                <div className="flex gap-2">
                    <button 
                        onClick={handleDownloadAll} 
                        disabled={isDownloading || images.every(i => i.status !== 'done')}
                        className="flex items-center justify-center bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-bold py-2 px-4 rounded-lg transition-all duration-300 disabled:from-base-300 disabled:to-base-300 disabled:text-gray-500 disabled:cursor-not-allowed text-sm"
                    >
                       {isDownloading ? <><Spinner size="5" /> Zipping...</> : <><DownloadIcon /> Download All</>}
                    </button>
                    <button onClick={resetState} className="text-sm text-text-secondary hover:text-text-primary transition-colors bg-base-300 px-4 py-2 rounded-lg">
                        Start Over
                    </button>
                </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {images.map(image => (
                    <div key={image.id} className="bg-base-300 rounded-lg shadow-md overflow-hidden relative aspect-square">
                         <img 
                            src={retryingImageId === image.id ? image.originalUrl : (image.processedUrl || image.originalUrl)} 
                            alt={image.processedUrl ? "Processed" : "Original"} 
                            className={`w-full h-full object-cover transition-all duration-300 ${retryingImageId === image.id ? 'cursor-crosshair' : ''}`}
                            onClick={(e) => handleRetryImageClick(e, image)}
                        />

                        {(image.status === 'verifying' || image.status === 'processing') && (
                            <div className="absolute inset-0 shimmer-bg flex flex-col items-center justify-center text-white p-2 backdrop-blur-sm bg-black/30">
                                <Spinner />
                                <p className="mt-2 text-sm font-semibold capitalize tracking-wider">{image.status}...</p>
                            </div>
                        )}

                        {image.status === 'failed' && (
                             <div className="absolute inset-0 bg-red-900/50 backdrop-blur-sm flex flex-col items-center justify-center text-white p-4 text-center">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-red-400 mb-2" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                </svg>
                                <p className="text-lg font-semibold capitalize">Processing Failed</p>
                                {image.error && <ErrorMessageWithLinks message={image.error} />}
                            </div>
                        )}
                        
                        {image.status === 'done' && retryingImageId !== image.id && (
                            <div className="absolute bottom-2 right-2 z-10">
                                <button
                                    onClick={() => handleStartReverify(image.id)}
                                    className="bg-black/50 backdrop-blur-sm hover:bg-black/80 text-white text-xs font-semibold py-1.5 px-3 rounded-full transition-all duration-200 shadow-lg border border-white/20"
                                    title="If the removal wasn't perfect, click here to try again."
                                >
                                    Fix This (1 Credit)
                                </button>
                            </div>
                        )}

                        {image.status === 'person_not_found' && retryingImageId !== image.id && (
                            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center text-white p-4 text-center">
                                <p className="font-bold mb-2">We couldn't find them.</p>
                                <p className="text-xs mb-4">Is the person you want to remove in this photo?</p>
                                <div className="flex flex-col gap-2 w-full max-w-xs">
                                    <button
                                        onClick={() => handlePersonNotInPhoto(image.id)}
                                        className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg text-sm w-full transition-transform hover:scale-105"
                                    >
                                        No, they aren't here
                                    </button>
                                    <button
                                        onClick={() => handleRetryIdentification(image.id)}
                                        className="btn-primary text-white font-bold py-2 px-4 rounded-lg text-sm w-full transition-transform hover:scale-105"
                                    >
                                        Yes, point them out
                                    </button>
                                </div>
                            </div>
                        )}

                        {retryingImageId === image.id && (
                            <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center text-white p-2 pointer-events-none">
                               <p className="font-bold text-lg">Click on the person to remove.</p>
                           </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );

    const renderPaymentModal = () => {
        if (!isPaymentModalOpen) return null;

        const creditPackages = [
            { credits: 5, price: 5, bestValue: false, link: 'PASTE_YOUR_STRIPE_LINK_FOR_5_CREDITS_HERE' },
            { credits: 15, price: 10, bestValue: true, link: 'PASTE_YOUR_STRIPE_LINK_FOR_15_CREDITS_HERE' },
        ];

        const isPaymentConfigured = creditPackages.every(p => !p.link.startsWith('PASTE_YOUR'));

        const handlePurchase = (pkg: typeof creditPackages[0]) => {
            if (!isPaymentConfigured) return;
            localStorage.setItem('pendingPurchase', pkg.credits.toString());
            window.open(pkg.link, '_blank');
        };

        return (
            <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" aria-modal="true" role="dialog">
                <div className="bg-base-200 rounded-2xl shadow-xl w-full max-w-md transform transition-all">
                    <div className="flex justify-between items-center p-4 border-b border-base-300">
                        <h3 className="text-xl font-bold">Buy More Credits</h3>
                        <button onClick={() => setIsPaymentModalOpen(false)} className="text-text-secondary hover:text-text-primary">
                            <CloseIcon />
                        </button>
                    </div>
                    <div className="p-6 space-y-4">
                        {!isPaymentConfigured && (
                             <div className="bg-yellow-500/10 border border-yellow-500/50 text-yellow-300 px-4 py-3 rounded-lg text-sm" role="alert">
                                <p className="font-bold">Attention Developer</p>
                                <p>Payment links are not configured. Please add your Stripe product links in <strong>App.tsx</strong> to enable purchases.</p>
                            </div>
                        )}
                        <p className="text-text-secondary">Choose a package to continue creating new memories.</p>
                        {creditPackages.map((pkg) => (
                            <button
                                key={pkg.credits}
                                onClick={() => handlePurchase(pkg)}
                                disabled={!isPaymentConfigured}
                                className={`w-full flex justify-between items-center text-left p-4 rounded-lg border-2 transition-all duration-200 relative ${pkg.bestValue ? 'border-brand-primary bg-brand-primary/10 hover:bg-brand-primary/20' : 'border-base-300 bg-base-300/50 hover:bg-base-300'} ${!isPaymentConfigured ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                                <div>
                                    <p className="font-bold text-lg">{pkg.credits} Credits</p>
                                    <p className="text-sm text-text-secondary">${pkg.price}.00 USD</p>
                                </div>
                                <span className="text-lg font-bold">${pkg.price}</span>
                                {pkg.bestValue && <div className="absolute top-0 right-4 -mt-3 bg-brand-primary text-white text-xs font-bold px-2 py-1 rounded-full">BEST VALUE</div>}
                            </button>
                        ))}
                         <p className="text-xs text-text-secondary text-center pt-2">You will be redirected to Stripe.com to complete your purchase securely.</p>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="min-h-screen bg-base-100 text-text-primary font-sans">
            {renderPaymentModal()}
            <div className="container mx-auto p-4 md:p-8">
                <header className="text-center mb-8">
                    <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
                        The <span className="text-gradient">Ex-Remover</span>
                    </h1>
                    <p className="text-lg text-text-secondary mt-2 max-w-2xl mx-auto">
                        Erase the past, one photo at a time. Let AI create new memories from old ones.
                    </p>
                    <div className="mt-6 inline-flex items-center bg-base-200/80 backdrop-blur-sm border border-base-300 rounded-full p-1 w-fit mx-auto shadow-lg">
                        <div className="flex items-center bg-base-300 rounded-full px-4 py-2">
                            <CreditIcon />
                            <span className="font-bold text-lg">{credits}</span>
                            <span className="text-text-secondary ml-2">Credits</span>
                        </div>
                        <button 
                            onClick={() => setIsPaymentModalOpen(true)}
                            className="btn-primary text-white font-bold py-2 px-5 rounded-full text-sm ml-2"
                        >
                            Buy More
                        </button>
                    </div>
                </header>

                {error && (
                    <div className="bg-red-500/20 border border-red-500 text-red-300 px-4 py-3 rounded-lg relative mb-6 text-center" role="alert">
                        <span className="block sm:inline">{error}</span>
                        <button onClick={() => setError(null)} className="absolute top-0 bottom-0 right-0 px-4 py-3">
                            <span className="text-xl">×</span>
                        </button>
                    </div>
                )}

                {successMessage && (
                    <div className="bg-green-500/20 border border-green-500 text-green-300 px-4 py-3 rounded-lg relative mb-6 text-center" role="alert">
                        <span className="block sm:inline">{successMessage}</span>
                         <button onClick={() => setSuccessMessage(null)} className="absolute top-0 bottom-0 right-0 px-4 py-3">
                            <span className="text-xl">×</span>
                        </button>
                    </div>
                )}
                
                <div className="max-w-4xl mx-auto">
                    <StepIndicator />
                    {step === 'upload' && renderUploadStep()}
                    {step === 'target' && renderTargetStep()}
                    {step === 'processing' && renderProcessingStep()}
                </div>
            </div>
        </div>
    );
};

export default App;