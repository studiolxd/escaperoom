// Visor local de los GLB del modo 3D (herramienta interna, no es la web del producto).
//   pnpm visor      (desde tools/assets-generator; abre http://localhost:5199)
import { createReadStream, existsSync, statSync } from 'node:fs'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const aqui = dirname(fileURLToPath(import.meta.url))
const PACK = process.env.PACK ?? 'medieval-v1'
const PACK_DIR = resolve(aqui, '../../../packages/web/public/packs', PACK)
const INFORME = resolve(aqui, '../packs', PACK, 'renders/glb/informe.json')
const TIPOS = { '.glb': 'model/gltf-binary', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp' }

function enviar(res, ruta) {
  res.setHeader('Content-Type', TIPOS[extname(ruta)] ?? 'application/octet-stream')
  res.setHeader('Cache-Control', 'no-store')
  createReadStream(ruta).pipe(res)
}

/** Sirve /pack/* (carpeta del pack en packages/web/public) y /informe.json (renders/glb/informe.json). */
function servirPack() {
  return {
    name: 'servir-pack',
    configureServer(server) {
      server.middlewares.use('/pack', (req, res, next) => {
        const ruta = join(PACK_DIR, decodeURIComponent((req.url ?? '').split('?')[0]))
        if (!ruta.startsWith(PACK_DIR + sep) || !existsSync(ruta) || statSync(ruta).isDirectory()) return next()
        enviar(res, ruta)
      })
      server.middlewares.use('/informe.json', (req, res, next) => (existsSync(INFORME) ? enviar(res, INFORME) : next()))
    },
  }
}

export default defineConfig({
  plugins: [servirPack()],
  resolve: { alias: { '/pack': PACK_DIR } },
  server: { fs: { allow: [aqui, PACK_DIR, resolve(aqui, '..')] } },
})
