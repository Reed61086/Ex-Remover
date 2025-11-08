
export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      // The result is a data URL: "data:image/png;base64,iVBORw0KGgo...".
      // We need to extract just the base64 part for the API.
      const base64Data = result.split(',')[1];
      if (!base64Data) {
        reject(new Error("Could not extract base64 data from file."));
      } else {
        resolve(base64Data);
      }
    };
    reader.onerror = (error) => reject(error);
  });
};
