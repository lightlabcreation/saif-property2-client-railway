const axios = require('axios');
const pdf = require('pdf-parse');
const { OpenAI } = require('openai');
const crypto = require('crypto');
const { saveDocumentChunks } = require('./qdrant.service');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Downloads a PDF from a URL and extracts its text
 */
async function extractTextFromPdfUrl(url) {
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const data = await pdf(response.data);
    return data.text;
  } catch (error) {
    console.error(`[DocProcessor] Failed to extract PDF from ${url}:`, error.message);
    return null;
  }
}

/**
 * Splits text into roughly manageable chunks (e.g., paragraphs or fixed length)
 */
function chunkText(text, maxChars = 1000) {
  const paragraphs = text.split(/\n\s*\n/);
  const chunks = [];
  let currentChunk = '';

  for (const p of paragraphs) {
    if ((currentChunk.length + p.length) > maxChars && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = '';
    }
    currentChunk += p + '\n\n';
  }
  
  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * Generates embeddings for text chunks using OpenAI
 */
async function generateEmbeddings(chunks) {
  if (!chunks || chunks.length === 0) return [];

  try {
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small", // or text-embedding-ada-002
      input: chunks,
    });
    return response.data;
  } catch (error) {
    console.error('[DocProcessor] Failed to generate embeddings:', error.message);
    throw error;
  }
}

/**
 * Main function to process a document and save to Qdrant.
 * Wraps everything in a try-catch to ensure it never crashes the main thread.
 * 
 * @param {String} cloudinaryUrl - The URL of the uploaded document
 * @param {Number} propertyId - The ID of the property
 * @param {String} docType - 'lease', 'inspection', etc.
 */
async function processAndSave(cloudinaryUrl, propertyId, docType = 'unknown') {
  try {
    console.log(`[DocProcessor] Starting background processing for ${docType} - Property ${propertyId}`);
    
    // 1. Extract Text
    const text = await extractTextFromPdfUrl(cloudinaryUrl);
    if (!text || text.trim().length === 0) {
      console.log(`[DocProcessor] No text found in document ${cloudinaryUrl}. Skipping.`);
      return;
    }

    // 2. Chunk Text
    const textChunks = chunkText(text);
    console.log(`[DocProcessor] Extracted ${textChunks.length} chunks from document.`);

    // 3. Generate Embeddings
    const embeddings = await generateEmbeddings(textChunks);

    // 4. Format for Qdrant
    const qdrantPoints = textChunks.map((chunkText, index) => {
      // Generate a deterministic UUID based on the URL and chunk index so re-processing updates rather than duplicates
      const hash = crypto.createHash('md5').update(`${cloudinaryUrl}_${index}`).digest('hex');
      const id = [
        hash.substring(0,8),
        hash.substring(8,12),
        hash.substring(12,16),
        hash.substring(16,20),
        hash.substring(20,32)
      ].join('-');

      return {
        id,
        vector: embeddings[index].embedding,
        payload: {
          text: chunkText,
          propertyId: Number(propertyId),
          docType: docType,
          sourceUrl: cloudinaryUrl
        }
      };
    });

    // 5. Save to Qdrant
    await saveDocumentChunks(qdrantPoints);
    console.log(`[DocProcessor] Successfully completed processing for ${cloudinaryUrl}`);
    
  } catch (error) {
    console.error(`[DocProcessor] Background processing failed for ${cloudinaryUrl}:`, error.message);
    // Deliberately not re-throwing so the caller (API endpoint) isn't affected.
  }
}

module.exports = {
  processAndSave
};
