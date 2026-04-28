# AG Albums360 Desktop per Mac

Reproductor de fitxers `.vtour` per macOS.

Aquesta app nomes visualitza tours. No inclou cap eina de compilacio.

## Build en macOS

```bash
npm install
npm run dist:mac
```

Els artefactes sortiran a `dist/`.

## Notes

- Per generar `.dmg` cal fer el build en macOS.
- Per distribuir sense avisos de Gatekeeper cal signar i notaritzar amb Apple Developer.
