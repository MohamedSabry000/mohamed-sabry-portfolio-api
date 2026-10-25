// Load .env before other modules read process.env (hosts like Vercel inject variables directly).
try {
  process.loadEnvFile()
} catch {
  // no .env file
}
