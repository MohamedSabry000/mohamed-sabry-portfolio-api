import { API_KEY, MODEL, app, ensureDb } from './app.js'
import { sanityStatus } from './sanity.js'

const PORT = Number(process.env.PORT ?? 8787)
const dbConnected = await ensureDb()

app.listen(PORT, () => {
  const sanity = sanityStatus()
  console.log(`API server on http://localhost:${PORT} — LLM ${API_KEY ? `enabled (${MODEL})` : 'disabled (local agent fallback)'}`)
  console.log(`MongoDB: ${dbConnected ? 'connected' : 'not connected (set MONGODB_URI)'}`)
  console.log(`Sanity: ${sanity.configured ? `connected (dataset ${sanity.dataset}${sanity.logging ? ', chat logging on' : ''})` : 'not configured'}`)
})
