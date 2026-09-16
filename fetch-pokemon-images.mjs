// fetch-pokemon-images.mjs
//
// Downloads images from URLs YOU supply and saves them into ./images/
// with the exact filenames your POKEMON_PACK entries expect, resized to
// 150x150 PNGs.
//
// You are responsible for only using image sources you have the rights
// or permission to use, even for personal projects.
//
// USAGE:
//   1. npm install sharp
//   2. Fill in the `SOURCES` map below with a URL for each id (paste
//      links you've found/downloaded yourself).
//   3. node fetch-pokemon-images.mjs
//
// Any id left blank in SOURCES is simply skipped (a message is printed).

import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

// id -> source URL (or local file path starting with "file://" or an
// absolute/relative path). Fill these in yourself.
const SOURCES = {
  "pikachu-01": "https://pokestop.io/img/pokemon/pikachu-256x256.png",
  "charmander-02": "https://pokestop.io/img/pokemon/charmander-256x256.png",
  "squirtle-03": "https://pokestop.io/img/pokemon/squirtle-256x256.png",
  "bulbasaur-04": "https://pokestop.io/img/pokemon/bulbasaur-256x256.png",
  "jigglypuff-05": "https://pokestop.io/img/pokemon/jigglypuff-256x256.png",
  "meowth-06": "https://pokestop.io/img/pokemon/meowth-256x256.png",
  "psyduck-07": "https://pokestop.io/img/pokemon/psyduck-256x256.png",
  "growlithe-08": "https://pokestop.io/img/pokemon/growlithe-256x256.png",
  "poliwag-09": "https://pokestop.io/img/pokemon/poliwag-256x256.png",
  "abra-10": "https://pokestop.io/img/pokemon/abra-256x256.png",
  "machop-11": "https://pokestop.io/img/pokemon/machop-256x256.png",
  "bellsprout-12": "https://pokestop.io/img/pokemon/bellsprout-256x256.png",
  "geodude-13": "https://pokestop.io/img/pokemon/geodude-256x256.png",
  "ponyta-14": "https://pokestop.io/img/pokemon/ponyta-256x256.png",
  "slowpoke-15": "https://pokestop.io/img/pokemon/slowpoke-256x256.png",
  "magnemite-16": "https://pokestop.io/img/pokemon/magnemite-256x256.png",
  "farfetchd-17": "https://pokestop.io/img/pokemon/farfetchd-256x256.png",
  "seel-18": "https://pokestop.io/img/pokemon/seel-256x256.png",
  "grimer-19": "https://pokestop.io/img/pokemon/grimer-256x256.png",
  "shellder-20": "https://pokestop.io/img/pokemon/shellder-256x256.png",
  "gastly-21": "https://pokestop.io/img/pokemon/gastly-256x256.png",
  "onix-22": "https://pokestop.io/img/pokemon/onix-256x256.png",
  "drowzee-23": "https://pokestop.io/img/pokemon/drowzee-256x256.png",
  "krabby-24": "https://pokestop.io/img/pokemon/krabby-256x256.png",
  "voltorb-25": "https://pokestop.io/img/pokemon/voltorb-256x256.png",
  "cubone-26": "https://pokestop.io/img/pokemon/cubone-256x256.png",
  "hitmonchan-27": "https://pokestop.io/img/pokemon/hitmonchan-256x256.png",
  "lickitung-28": "https://pokestop.io/img/pokemon/lickitung-256x256.png",
  "koffing-29": "https://pokestop.io/img/pokemon/koffing-256x256.png",
  "rhyhorn-30": "https://pokestop.io/img/pokemon/rhyhorn-256x256.png"
}

const OUT_DIR = path.resolve("./images");
const SIZE = 150;

async function fetchBuffer(source) {
  if (/^https?:\/\//i.test(source)) {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  // Treat anything else as a local file path.
  const localPath = source.startsWith("file://")
    ? new URL(source).pathname
    : source;
  return fs.readFile(localPath);
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const ids = Object.keys(SOURCES);
  let done = 0, skipped = 0, failed = 0;

  for (const id of ids) {
    const source = SOURCES[id]?.trim();
    const outPath = path.join(OUT_DIR, `${id.replace(/-\d+$/, "")}.png`);

    if (!source) {
      console.log(`⏭  skipped ${id} (no source set)`);
      skipped++;
      continue;
    }

    try {
      const buf = await fetchBuffer(source);
      await sharp(buf)
        .resize(SIZE, SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toFile(outPath);
      console.log(`✅ ${id} -> ${outPath}`);
      done++;
    } catch (err) {
      console.error(`❌ ${id}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone: ${done} saved, ${skipped} skipped, ${failed} failed.`);
}

main();
