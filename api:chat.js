export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { message } = req.body;
    const response = await callClaude(message);
    res.status(200).json({ reply: response });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}