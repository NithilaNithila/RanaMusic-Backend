function s(r=0){const t=Number(r);if(!Number.isFinite(t)||t<0)return"0:00";const o=Math.floor(t/60),n=Math.floor(t%60).toString().padStart(2,"0");return`${o}:${n}`}export{s as f};
