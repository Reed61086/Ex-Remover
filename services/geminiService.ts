import { GoogleGenAI, Modality } from "@google/genai";

const getAi = () => {
    // This now exclusively uses the API key from the environment secrets.
    // It's the developer's responsibility to set this up in their hosting provider (e.g., Vercel, Netlify, or GitHub Codespaces secrets).
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
        throw new Error("API_KEY is not configured in the application's environment. The developer needs to set this up in their hosting provider's settings.");
    }
    return new GoogleGenAI({ apiKey });
};

const handleApiError = (error: unknown, context: string): Error => {
    console.error(`Error calling Gemini for ${context}:`, error);
    if (error instanceof Error) {
        if (error.message.includes('RESOURCE_EXHAUSTED') || error.message.includes('quota')) {
             return new Error(`The service has exceeded its free usage limit. To continue using the app, the developer must enable billing. For more info, visit: https://ai.google.dev/gemini-api/docs/billing`);
        }
        return new Error(`Gemini API error during ${context}: ${error.message}`);
    }
    return new Error(`An unknown error occurred during ${context}.`);
}


export const isPersonInImage = async (
    base64ImageData: string,
    mimeType: string,
    personDescription: string
): Promise<boolean> => {
    try {
        const ai = getAi();
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
            // Throw an error for unexpected responses to prevent incorrect processing.
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
        const ai = getAi();
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


export const editImage = async (
    base64ImageData: string,
    mimeType: string,
    prompt: string
): Promise<string> => {
    // This function uses the advanced Gemini image model for Key Inpainting and Editing (KIE).
    try {
        const ai = getAi();
        const imagePart = {
            inlineData: {
                data: base64ImageData,
                mimeType: mimeType,
            },
        };
        const textPart = { text: prompt };

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: { parts: [imagePart, textPart] },
            config: {
                responseModalities: [Modality.IMAGE],
            },
        });

        for (const part of response.candidates[0].content.parts) {
            if (part.inlineData && part.inlineData.mimeType.startsWith('image/')) {
                const base64ImageBytes: string = part.inlineData.data;
                const imageMimeType: string = part.inlineData.mimeType;
                return `data:${imageMimeType};base64,${base64ImageBytes}`;
            }
        }

        throw new Error("No image data was found in the Gemini API response.");

    } catch (error) {
        throw handleApiError(error, 'image editing');
    }
};