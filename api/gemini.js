export default async function handler(req, res) {
  try {
    const { imageBase64 } = await req.json();

    const response = await fetch("https://api.nanobanana.ai/v1/identify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.GEMINI_API_KEY}`
      },
      body: JSON.stringify({ image: imageBase64 })
    });

    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Gemini proxy error" });
  }
}
