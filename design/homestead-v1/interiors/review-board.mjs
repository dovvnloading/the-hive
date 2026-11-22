import fs from 'node:fs/promises';
import path from 'node:path';

/** A standalone art review, deliberately separate from the facility interface. */
export async function writeReviewBoard(output, manifest) {
  const titles = {
    architecture: 'The room',
    tables: 'Places to work',
    storage: 'Shelves & soft corners',
    chairs: 'A seat at the table',
    fixtures: 'On the walls',
    details: 'Little things',
    icons: 'In your hands',
  };
  const label = (name) => name.replace(/^icon-/, '').replaceAll('-', ' ');
  const sections = Object.entries(titles)
    .map(
      ([sheet, title]) =>
        `<section><h2>${title}</h2><div class="grid">${manifest.assets
          .filter((asset) => asset.sheet === sheet)
          .map(
            (asset) =>
              `<button class="asset" data-file="${asset.name}" data-pair="${asset.lightingPair}" aria-label="Inspect ${label(asset.name)}"><span class="matte"><img src="${asset.name}.png" alt="" width="${asset.width}" height="${asset.height}"></span><span class="caption">${label(asset.name)}<small>${asset.width} × ${asset.height} px</small></span></button>`,
          )
          .join('')}</div></section>`,
    )
    .join('');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>The Hive · Interior art board</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#efe8d9;color:#352f25;font:16px/1.5 Georgia,serif;--matte:#e6deca}header,main,footer{max-width:1320px;margin:auto;padding:32px}header{padding-bottom:14px}.eyebrow{font:12px/1.5 system-ui;letter-spacing:.15em;text-transform:uppercase;color:#5e6b50}h1{font-weight:400;font-size:clamp(32px,5vw,52px);line-height:1.1;margin:14px 0}p{max-width:720px;color:#655e50}h2{font-weight:400;font-size:26px;margin:32px 0 16px}.toolbar{position:sticky;top:0;z-index:2;display:flex;flex-wrap:wrap;gap:16px;align-items:center;padding:14px 32px;background:#efe8d9f5;border-block:1px solid #cfc5af;backdrop-filter:blur(12px)}fieldset{display:flex;gap:6px;border:0;margin:0;padding:0;align-items:center}legend{float:left;margin-right:10px;font:12px system-ui;color:#655e50}button,select{font:14px system-ui}fieldset button,.close{padding:8px 12px;background:transparent;color:inherit;border:1px solid #b3aa95;border-radius:4px;cursor:pointer}button[aria-pressed=true]{background:#455e4c;color:#fff9ea;border-color:#455e4c}button:focus-visible{outline:3px solid #a5602c;outline-offset:4px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:18px}.asset{padding:0;border:1px solid #cabfa8;background:#f7f0e2;text-align:left;cursor:zoom-in;color:inherit;border-radius:6px;overflow:hidden}.asset:hover{border-color:#73805d}.matte{display:flex;height:230px;align-items:center;justify-content:center;padding:16px;background:var(--matte)}.matte img{max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;image-rendering:pixelated}.caption{display:block;padding:12px 14px;font:15px Georgia,serif;text-transform:capitalize}.caption small{display:block;color:#776c59;font:11px system-ui;letter-spacing:.03em;padding-top:5px}footer{font:13px/1.6 system-ui;color:#655e50}dialog{max-width:94vw;max-height:92vh;padding:20px;border:1px solid #8a7b5c;border-radius:6px;background:#f7f0e2;color:#352f25}dialog::backdrop{background:#15251edd}.detail-head{display:flex;justify-content:space-between;align-items:center;gap:24px;margin-bottom:14px}.detail-head h2{margin:0;text-transform:capitalize;font-size:22px}.detail-matte{background:var(--matte);padding:16px;overflow:auto;max-height:72vh;text-align:center}.detail-matte img{display:block;margin:auto;image-rendering:pixelated}.detail-note{font:12px system-ui;color:#776c59;margin:10px 0 0}body[data-backdrop=slate]{--matte:#29322f}body[data-backdrop=magenta]{--matte:#ff00ff}@media(max-width:600px){header,main,footer{padding:20px}.toolbar{padding:12px 20px}.grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.matte{height:180px;padding:10px}.caption{font-size:13px}.detail-matte img{max-width:none}}
</style></head><body data-backdrop="linen"><header><div class="eyebrow">The Hive / Interior collection</div><h1>Oak, linen & sage.</h1><p>A complete family of room pieces, furniture, fixtures and hand-held symbols. ${manifest.assets.length} native-resolution sprites; ${manifest.assets.filter((asset) => asset.lightingPair).length} matching lights-off partners. Select a piece to inspect its original pixels.</p></header>
<div class="toolbar"><fieldset aria-label="Lighting"><legend>Lighting</legend><button data-light="warm" aria-pressed="true">Warm light</button><button data-light="dark" aria-pressed="false">Lights off</button></fieldset><fieldset aria-label="Backdrop"><legend>Backdrop</legend><button data-backdrop="linen" aria-pressed="true">Linen</button><button data-backdrop="slate" aria-pressed="false">Slate</button><button data-backdrop="magenta" aria-pressed="false">Magenta key</button></fieldset></div>
<main>${sections}</main><footer>The source sheets were generated with an opaque magenta chroma background. Exported PNGs have real alpha, with no checkerboard painted into the artwork. Source artwork is retained at its original resolution. The lighting selector changes only this review board.</footer>
<dialog><div class="detail-head"><h2 id="detail-title"></h2><button class="close" autofocus>Close</button></div><div class="detail-matte"><img id="detail-image" alt=""></div><p class="detail-note">Native size · one source pixel per CSS pixel · Escape to close</p></dialog>
<script>
let lighting='warm';
const dialog=document.querySelector('dialog');
const source=(card)=>(lighting==='dark'&&card.dataset.pair==='true'?'lights-off/':'')+card.dataset.file+'.png';
document.querySelectorAll('[data-light]').forEach(button=>button.addEventListener('click',()=>{lighting=button.dataset.light;document.querySelectorAll('[data-light]').forEach(other=>other.setAttribute('aria-pressed',String(other===button)));document.querySelectorAll('.asset').forEach(card=>card.querySelector('img').src=source(card));}));
document.querySelectorAll('button[data-backdrop]').forEach(button=>button.addEventListener('click',()=>{document.body.dataset.backdrop=button.dataset.backdrop;document.querySelectorAll('button[data-backdrop]').forEach(other=>other.setAttribute('aria-pressed',String(other===button)));}));
document.querySelectorAll('.asset').forEach(card=>card.addEventListener('click',()=>{document.querySelector('#detail-title').textContent=card.dataset.file.replace(/^icon-/,'').replaceAll('-',' ');const img=document.querySelector('#detail-image');img.src=source(card);img.alt=card.getAttribute('aria-label').replace('Inspect ','');dialog.setAttribute('aria-labelledby','detail-title');dialog.showModal();}));
document.querySelector('.close').addEventListener('click',()=>dialog.close());
</script></body></html>`;
  await fs.writeFile(path.join(output, 'asset-board.html'), html);
}
