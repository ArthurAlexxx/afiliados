const {chromium}=require('playwright');
(async()=>{const [,,html,out,fps,dur,only]=process.argv;
const b=await chromium.launch();const pg=await b.newPage({viewport:{width:1080,height:1920}});
await pg.goto('file://'+html);await pg.evaluate(()=>document.fonts.ready);await pg.waitForTimeout(300);
const times=only?only.split(',').map(Number):[...Array(Math.round(dur*fps)).keys()].map(i=>i/fps);
for(let i=0;i<times.length;i++){await pg.evaluate(t=>window.render(t),times[i]);
 await pg.screenshot({path:`${out}/f${String(i).padStart(4,'0')}.jpg`,type:'jpeg',quality:93});}
await b.close();})();
