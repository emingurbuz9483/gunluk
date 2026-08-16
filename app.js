/* Sürtünme Günlüğü — tek iş: bir düşünceyi 3 saniyenin altında yakalamak. */

/* ---------- IndexedDB: gunluk / kayit ---------- */
const DB_ADI = 'gunluk', DEPO = 'kayit';
let _db;
function db(){
  if(!_db) _db = new Promise((coz, red) => {
    const i = indexedDB.open(DB_ADI, 1);
    i.onupgradeneeded = () => i.result.createObjectStore(DEPO, { keyPath:'id', autoIncrement:true });
    i.onsuccess = () => coz(i.result);
    i.onerror   = () => red(i.error);
  });
  return _db;
}
// Her çağrı için taze işlem: await sırasında işlemin kapanma riski olmasın.
async function depo(mod){ return (await db()).transaction(DEPO, mod).objectStore(DEPO); }
function bekle(i){ return new Promise((coz,red)=>{ i.onsuccess=()=>coz(i.result); i.onerror=()=>red(i.error); }); }

async function ekle(k){ return bekle((await depo('readwrite')).add(k)); }
async function tumKayitlar(){ return bekle((await depo('readonly')).getAll()); }
async function silKayit(id){ return bekle((await depo('readwrite')).delete(id)); }
async function yamaKonum(id, konum){
  const k = await bekle((await depo('readonly')).get(id));
  if(!k) return;
  k.konum = konum;
  await bekle((await depo('readwrite')).put(k));
}

/* ---------- Konum: ASLA reddetmez. Hata/zaman aşımında null döner. ---------- */
function konumAl(){
  return new Promise(coz => {
    if(!navigator.geolocation) return coz(null);
    setTimeout(() => coz(null), 6000);            // izin balonu asılı kalırsa emniyet freni
    navigator.geolocation.getCurrentPosition(
      p  => coz({ lat:+p.coords.latitude.toFixed(5), lon:+p.coords.longitude.toFixed(5) }),
      () => coz(null),
      { timeout:5000, maximumAge:60000 }
    );
  });
}

/* ---------- Kısayollar ---------- */
const $ = s => document.querySelector(s);
const kayitBtn = $('#kayitBtn'), sureEl = $('#sure'), uyariEl = $('#uyari'),
      etiketEl = kayitBtn.querySelector('.etiket'), liste = $('#liste'), bosEl = $('#bos'),
      baslikEl = $('#baslik'), yaziForm = $('#yaziForm'), yaziGiris = $('#yaziGiris'),
      sablon = $('#satirSablon');

function uyar(m){
  uyariEl.textContent = m;
  clearTimeout(uyar._z);
  uyar._z = setTimeout(() => uyariEl.textContent = '', 4000);
}
const ss = ms => { const s = Math.floor(ms/1000); return Math.floor(s/60)+':'+String(s%60).padStart(2,'0'); };

/* ---------- Ses kaydı ---------- */
let recorder=null, akis=null, parcalar=[], sayac=null, t0=0, konumSozu=null, mesgul=false;
const EN_UZUN = 5*60*1000;                        // cepte unutulursa 5 dk sonra kendi durur

kayitBtn.addEventListener('click', () => { recorder ? kaydiBitir() : kaydaBasla(); });

async function kaydaBasla(){
  if(mesgul) return;
  if(!(window.MediaRecorder && navigator.mediaDevices)){ uyar('bu tarayıcı ses kaydı desteklemiyor'); return; }
  mesgul = true;
  konumSozu = konumAl();                          // paralel; kaydı asla bekletmez
  try{ akis = await navigator.mediaDevices.getUserMedia({ audio:true }); }
  catch(e){ akis=null; mesgul=false; uyar('mikrofon izni yok — yazarak kaydedebilirsin'); return; }
  recorder = new MediaRecorder(akis);
  parcalar = [];
  recorder.ondataavailable = e => { if(e.data && e.data.size) parcalar.push(e.data); };
  recorder.onstop = sesiYaz;
  recorder.start();
  mesgul = false;
  t0 = Date.now();
  kayitBtn.classList.add('kaydediyor');
  etiketEl.textContent = 'Kaydediliyor…';
  sureEl.textContent = '0:00';
  sayac = setInterval(() => {
    const g = Date.now()-t0;
    sureEl.textContent = ss(g);
    if(g >= EN_UZUN) kaydiBitir();
  }, 250);
}

function kaydiBitir(){
  if(!recorder) return;
  try{ recorder.stop(); }catch(e){}                // devamı onstop -> sesiYaz
  clearInterval(sayac); sayac=null;
  kayitBtn.classList.remove('kaydediyor');
  etiketEl.textContent = 'Kaydet';
  sureEl.textContent = '';
}

async function sesiYaz(){
  const tip = (recorder && recorder.mimeType) || '';   // Safari audio/mp4, Chrome audio/webm — asla sabit yazma
  const ses = new Blob(parcalar, { type:tip });
  mikrofonuBirak();
  recorder = null; parcalar = [];
  if(!ses.size) return;
  const id = await ekle({ ts:Date.now(), metin:'', konum:null, ses, sesTip:tip });  // önce yaz, sonra düşün
  ciz();
  konumuIsle(id);
}

// Mikrofonu bırak: bu olmazsa telefondaki turuncu kayıt ışığı sönmez.
function mikrofonuBirak(){
  if(akis){ akis.getTracks().forEach(t => t.stop()); akis = null; }
}

function konumuIsle(id){
  const s = konumSozu || konumAl();
  konumSozu = null;
  s.then(k => { if(k) yamaKonum(id,k).then(ciz); });   // gelmezse görünür hiçbir şey olmaz
}

/* ---------- Yazarak yakalama ---------- */
yaziForm.addEventListener('submit', async e => {
  e.preventDefault();
  const metin = yaziGiris.value.trim();
  if(!metin) return;
  yaziGiris.value = '';                            // anında temizle
  const konumS = konumAl();                        // paralel
  const id = await ekle({ ts:Date.now(), metin, konum:null, ses:null, sesTip:'' });
  ciz();
  konumS.then(k => { if(k) yamaKonum(id,k).then(ciz); });
});

/* ---------- Bugünün kayıtları ---------- */
let gunun = [];
const ayniGun = ts => {
  const a = new Date(ts), b = new Date();
  return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
};
const saatOf = ts => new Date(ts).toLocaleTimeString('tr-TR', { hour:'2-digit', minute:'2-digit' });

async function ciz(){
  const tum = await tumKayitlar();
  gunun = tum.filter(k => ayniGun(k.ts)).sort((a,b) => b.ts-a.ts);   // en yeni üstte
  baslikEl.textContent = 'bugün · ' + gunun.length + ' kayıt';
  bosEl.toggleAttribute('hidden', gunun.length > 0);
  // Çalan kaydın id'sini koru: yeniden çizim dinlemeyi yarıda kesmesin.
  const calanKayit = (calanBtn && !calar.paused) ? calanBtn.closest('.kayitSatir').dataset.id : null;
  calanBtn = null;
  liste.textContent = '';
  for(const k of gunun){
    const li = sablon.content.firstElementChild.cloneNode(true);
    li.dataset.id = k.id;
    li.querySelector('.saat').textContent = saatOf(k.ts);
    li.querySelector('.metin').textContent = k.metin || '';
    const oyn = li.querySelector('.oynat');
    // .hidden ÖZELLİĞİ SVG'de yok; her ikisinde de NİTELİĞİ değiştir.
    oyn.toggleAttribute('hidden', !k.ses);
    if(k.ses) oyn.addEventListener('click', () => oynat(k, oyn));
    li.querySelector('.pin').toggleAttribute('hidden', !k.konum);   // pin yalnızca konum varsa
    if(String(k.id) === calanKayit){ calanBtn = oyn; oyn.classList.add('calisiyor'); oyn.querySelector('.ucgen').setAttribute('d', DURDUR_D); }
    li.querySelector('.sil').addEventListener('click', () => silOnay(li, k.id));
    kaydirmaBagla(li);
    liste.appendChild(li);
  }
  if(calanKayit && !calanBtn) durdur();          // çalan kayıt silindiyse sesi de kes
}

/* ---------- Satır içi oynatma ---------- */
const OYNAT_D = 'M8 5l11 7-11 7z', DURDUR_D = 'M8 5h3v14H8zM13 5h3v14h-3z';
const calar = new Audio();
let acikUrl = null, calanBtn = null;
calar.addEventListener('ended', () => durdur());

function durdur(){
  calar.pause();
  if(calanBtn){
    calanBtn.classList.remove('calisiyor');
    calanBtn.querySelector('.ucgen').setAttribute('d', OYNAT_D);
    calanBtn = null;
  }
}
function oynat(k, btn){
  const ayni = calanBtn === btn;
  durdur();
  if(ayni) return;                                  // ikinci dokunuş durdurur
  if(acikUrl) URL.revokeObjectURL(acikUrl);
  // MIME tipini kayıttan geri ver: iOS, tipsiz blob'u çalmayabiliyor.
  acikUrl = URL.createObjectURL(k.sesTip ? new Blob([k.ses], { type:k.sesTip }) : k.ses);
  calar.src = acikUrl;
  calar.play().catch(() => uyar('ses çalınamadı'));
  calanBtn = btn;
  btn.classList.add('calisiyor');
  btn.querySelector('.ucgen').setAttribute('d', DURDUR_D);
}

/* ---------- Silme: sola kaydır / uzun bas -> onay ---------- */
function silOnay(li, id){
  const b = li.querySelector('.sil');
  if(!b.classList.contains('onay')){
    b.classList.add('onay'); b.textContent = 'Emin misin?';
    clearTimeout(b._z);
    b._z = setTimeout(() => { b.classList.remove('onay'); b.textContent='Sil'; li.classList.remove('acik'); }, 4000);
    return;
  }
  silKayit(id).then(ciz);
}
function kapat(haric){
  liste.querySelectorAll('.kayitSatir.acik').forEach(o => {
    if(o === haric) return;
    o.classList.remove('acik');
    const b = o.querySelector('.sil'); b.classList.remove('onay'); b.textContent = 'Sil';
  });
}
function kaydirmaBagla(li){
  const kay = li.querySelector('.kaydir');
  let x0=0, y0=0, uzun=null, acildi=false;
  const ac = () => { kapat(li); li.classList.add('acik'); };
  kay.addEventListener('pointerdown', e => {
    x0=e.clientX; y0=e.clientY; acildi=false;
    clearTimeout(uzun); uzun = setTimeout(ac, 550);            // uzun bas
  });
  kay.addEventListener('pointermove', e => {
    const dx = e.clientX-x0, dy = e.clientY-y0;
    if(Math.abs(dx)>8 || Math.abs(dy)>8) clearTimeout(uzun);
    if(dx < -55 && Math.abs(dy) < 30 && !acildi){ acildi=true; ac(); }   // sola kaydır
    if(dx > 25) li.classList.remove('acik');
  });
  const bitis = () => clearTimeout(uzun);
  kay.addEventListener('pointerup', bitis);
  kay.addEventListener('pointercancel', bitis);
}
document.addEventListener('pointerdown', e => { if(!e.target.closest('.kayitSatir')) kapat(null); });

/* ---------- Kaçış kapısı: hepsini JSON olarak panoya ---------- */
$('#disaAktar').addEventListener('click', async e => {
  e.preventDefault();
  const tum = await tumKayitlar();
  const yazi = JSON.stringify(tum.map(k => ({
    id:k.id, ts:k.ts, metin:k.metin, konum:k.konum, ses:k.ses ? '[ses]' : null, sesTip:k.sesTip
  })), null, 2);
  const tamam = () => uyar(tum.length + ' kayıt panoya kopyalandı');
  try{ await navigator.clipboard.writeText(yazi); tamam(); }
  catch(_){                                                   // Clipboard API yoksa: eski yol
    const ta = document.createElement('textarea');
    ta.value = yazi; ta.setAttribute('readonly','');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(ta);
    ta.select(); ta.setSelectionRange(0, yazi.length);
    const ok = document.execCommand('copy');
    ta.remove();
    ok ? tamam() : uyar('kopyalanamadı');
  }
});

/* ---------- Açılış ---------- */
ciz();
document.addEventListener('visibilitychange', () => { if(!document.hidden) ciz(); });  // gün dönerse liste tazelensin
addEventListener('pagehide', () => { kaydiBitir(); mikrofonuBirak(); });               // mikrofonu asla açık bırakma
if('serviceWorker' in navigator){
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(()=>{}));
}
