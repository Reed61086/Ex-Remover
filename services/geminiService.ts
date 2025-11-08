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
                    { text: `Analyze the image. A person is described as: "${personDescription}". Is this specific person present in the image? Please answer with only the word "true" or "false".` }
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

        const prompt = `In the provided image, a user has clicked at coordinates (x=${x}, y=${y}). Please provide a detailed, objective description of the person at or nearest to these coordinates. Focus on visible characteristics like clothing (color, style), hair (color, style, length), accessories (glasses, hats, jewelry), and general build. Do not guess their name, age, or ethnicity. The description should be precise enough to uniquely identify this individual in a group photo. For example: "Person wearing a red t-shirt, blue jeans, short brown hair, and black glasses."`;

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