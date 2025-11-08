
import { GoogleGenAI, Modality } from "@google/genai";
import { fileToBase64 } from "../utils/fileUtils";

// --- Configuration ---
// DEVELOPER NOTE: This application is configured to use the Gemini API.
// Ensure your API key is available as `process.env.API_KEY` in your environment.

// FIX: Per coding guidelines, API key must be from process.env.API_KEY and used directly.
const getGeminiAi = () => {
    if (!process.env.API_KEY) {
        throw new Error("API_KEY environment variable is not configured. The developer needs to set this.");
    }
    return new GoogleGenAI({ apiKey: process.env.API_KEY });
};

const handleApiError = (error: unknown, context: string): Error => {
    console.error(`Error during ${context}:`, error);
    if (error instanceof Error) {
        if (error.message.includes('RESOURCE_EXHAUSTED') || error.message.includes('quota')) {
             return new Error(`The service has exceeded its free usage limit. To continue using the app, the developer must enable billing. For more info, visit: https://ai.google.dev/gemini-api/docs/billing`);
        }
        return new Error(`API error during ${context}: ${error.message}`);
    }
    return new Error(`An unknown error occurred during ${context}.`);
}


export const isPersonInImage = async (
    base64ImageData: string,
    mimeType: string,
    personDescription: string
): Promise<boolean> => {
    try {
        const ai = getGeminiAi();
        const imagePart = {
            inlineData: {
                mimeType: mimeType,
                data: base64ImageData,
            },
        };

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: {
                parts: [
                    imagePart,
                    { text: `Analyze the image. A person is described by their facial features as: "${personDescription}". Is this specific person present in the image? Please answer with only the word "true" or "false".` }
                ]
            },
        });
        
        const text = response.text.trim().toLowerCase();
        if (text !== 'true' && text !== 'false') {
            throw new Error(`Unexpected response from AI when verifying person's presence. Got: "${response.text}". Expected "true" or "false".`);
        }
        return text === 'true';

    } catch (error) {
        throw handleApiError(error, 'person verification');
    }
};

export const identifyPersonAt = async (
    base64ImageData: string,
    mimeType: string,
    x: number,
    y: number
): Promise<string> => {
    try {
        const ai = getGeminiAi();
        const imagePart = {
            inlineData: {
                mimeType: mimeType,
                data: base64ImageData,
            },
        };

        const prompt = `Analyze the person nearest to coordinates (x=${x}, y=${y}). Provide a description focusing ONLY on permanent facial features and head structure. Describe their face shape, eye color and shape, nose, mouth, and any unique, permanent facial markings. CRUCIALLY, DO NOT mention clothing, glasses, hats, or any temporary items. The description must be robust enough to identify the same person even if they change their outfit. For example: "Person with an oval face, high cheekbones, thin lips, and almond-shaped blue eyes."`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: { parts: [imagePart, { text: prompt }] },
        });

        const description = response.text.trim();
        if (!description) {
            throw new Error("Gemini did not return a description.");
        }
        return description;

    } catch (error) {
        throw handleApiError(error, 'identification');
    }
};

// FIX: Refactored to use Gemini API directly for image editing, removing the complex and insecure KIE.ai/GitHub integration.
export const editImage = async (
    imageFile: File,
    description: string
): Promise<string> => {
    try {
        const ai = getGeminiAi();
        const base64ImageData = await fileToBase64(imageFile);

        const imagePart = {
          inlineData: {
            data: base64ImageData,
            mimeType: imageFile.type,
          },
        };

        const textPart = {
          text: `In this photo, find the person described as "${description}" and completely remove them. Reconstruct the background behind them with perfect photorealism, matching the lighting, textures, and perspective of the surrounding area. The final result should look like the person was never there.`,
        };
        
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: {
                parts: [imagePart, textPart],
            },
            config: {
                responseModalities: [Modality.IMAGE],
            },
        });

        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData) {
            const base64ImageBytes: string = part.inlineData.data;
            const mimeType = part.inlineData.mimeType;
            return `data:${mimeType};base64,${base64ImageBytes}`;
          }
        }

        throw new Error("Gemini API did not return an edited image.");

    } catch (error) {
        throw handleApiError(error, 'image editing');
    }
};
