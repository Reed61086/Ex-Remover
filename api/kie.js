export default async function handler(req, res) {
  try {
    const { imageBase64, editParams } = await req.json();

    const response = await fetch("https://api.kie.ai/v1/edit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.KIE_API_KEY}`
      },
      body: JSON.stringify({ image: imageBase64, ...editParams })
    });

    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "KIE proxy error" });
  }
}
