# Architecture decision

OpenRadar uses Tauri 2 with React 19, TypeScript, Vite, and MapLibre GL. This keeps the desktop shell small while letting the app render vector maps and raster weather data on the GPU. Rust services can later decode NEXRAD and MRMS data away from the interface thread.

The foundation is a trimmed implementation of patterns already proven in StormDeck. It keeps the MapLibre worker on the app origin and stores settings in readable JSON. OpenRadar improves on the surveyed alternatives by treating globe projection, pitch, bearing, center, and zoom as first-class camera state while keeping radar playback independent.

WPF with WebView2 would be Windows-only and still carry two runtimes. Avalonia has a weaker path for the planned raster and custom radar layers. Electron adds a much larger desktop runtime. Qt brings licensing and distribution friction that does not help this project.

The product name is OpenRadar as requested. GitHub has unrelated projects with the same words, mainly mmWave and software issue trackers, but no repository exists under the selected owner and no exact weather app listing surfaced in the Microsoft Store search.

