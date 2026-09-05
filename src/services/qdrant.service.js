const { QdrantClient } = require('@qdrant/js-client-rest');

const qdrantClient = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

const COLLECTION_NAME = 'pms_documents';

/**
 * Initializes the collection if it doesn't exist
 */
async function initCollection() {
  try {
    const collections = await qdrantClient.getCollections();
    const exists = collections.collections.some(c => c.name === COLLECTION_NAME);
    
    if (!exists) {
      await qdrantClient.createCollection(COLLECTION_NAME, {
        vectors: {
          size: 1536, // OpenAI embedding size
          distance: 'Cosine',
        },
      });
      console.log(`[Qdrant] Collection ${COLLECTION_NAME} created.`);
    }
  } catch (error) {
    console.error('[Qdrant] Error initializing collection:', error.message);
  }
}

// Call init on load
initCollection();

/**
 * Saves document chunks to Qdrant
 * @param {Array} chunks - Array of objects { id, vector, payload: { text, propertyId, docType, sourceUrl } }
 */
async function saveDocumentChunks(chunks) {
  if (!chunks || chunks.length === 0) return;
  
  try {
    await qdrantClient.upsert(COLLECTION_NAME, {
      wait: true,
      points: chunks
    });
    console.log(`[Qdrant] Successfully saved ${chunks.length} chunks.`);
  } catch (error) {
    console.error('[Qdrant] Error saving document chunks:', error.message);
    throw error;
  }
}

/**
 * Searches for relevant documents based on propertyId
 * @param {Array} queryVector - The embedding of the user's question
 * @param {Number} propertyId - The active property ID
 * @param {Number} limit - Max chunks to return
 */
async function searchDocuments(queryVector, propertyId, limit = 5) {
  try {
    const searchResults = await qdrantClient.search(COLLECTION_NAME, {
      vector: queryVector,
      limit: limit,
      filter: {
        must: [
          {
            key: 'propertyId',
            match: {
              value: Number(propertyId)
            }
          }
        ]
      },
      with_payload: true
    });
    
    return searchResults.map(res => res.payload.text);
  } catch (error) {
    console.error('[Qdrant] Error searching documents:', error.message);
    return []; // Return empty gracefully so it doesn't crash the AI flow
  }
}

module.exports = {
  saveDocumentChunks,
  searchDocuments
};
