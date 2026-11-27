import { generateObjectQuestion, objectOrthographicSvg, objectPerspectiveSvg } from './object-views.mjs';

/** Group adjacent fixed menu regions into one shared tutorial per physical wall. */
export function sharedTutorialWalls(zones) {
  const groups = new Map();
  for (const zone of zones) {
    const angle = zone.rotationDegrees;
    const key = `${angle}:${angle % 180 ? zone.rect.x : zone.rect.y}`;
    if (!groups.has(key)) groups.set(key, { id: `tutorial-${key}`, rotationDegrees: angle, rect: { ...zone.rect } });
    else {
      const r = groups.get(key).rect, z = zone.rect;
      const x = Math.min(r.x, z.x), y = Math.min(r.y, z.y);
      Object.assign(r, { x, y, width: Math.max(r.x + r.width, z.x + z.width) - x, height: Math.max(r.y + r.height, z.y + z.height) - y });
    }
  }
  return [...groups.values()];
}

const text = (x,y,value,size=28,color='#f5f8ff') => `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" fill="${color}" font-size="${size}" font-weight="700">${value}</text>`;
const rect = (x,y,w,h,fill,stroke='#536b88') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="${fill}" stroke="${stroke}" stroke-width="3"/>`;
const svg = content => `<svg viewBox="0 0 640 420" xmlns="http://www.w3.org/2000/svg" role="img">${content}</svg>`;
const pointer = (x,y) => `<circle class="tutorial-tap-ring" cx="${x}" cy="${y}" r="27" fill="none" stroke="#ffdf70" stroke-width="6"/>`;
const confirm = label => rect(200,338,240,62,'#147d70','#63e3ca')+text(320,370,label,30);
function grid(values,cols,{x=145,y=28,size=70,colors=[],highlight=[]}={}) {
  return values.map((value,i)=>{const cx=x+i%cols*size,cy=y+Math.floor(i/cols)*size;return rect(cx,cy,size-4,size-4,colors[i]??'#edf3fa',highlight.includes(i)?'#ffcf4f':'#647995')+text(cx+(size-4)/2,cy+(size-4)/2,value,28,colors[i]==='#000'?'#fff':'#142338');}).join('');
}
function mine(step) {
  const values=step===0?['起','','','','','','','','']:step===1?['0','0','0','0','1','1','0','1','⚑']:['0','0','0','0','1','1','0','1','⚑'];
  return svg(rect(140,15,360,48,step===1?'#ffce3a':'#1262b5')+text(320,40,step===1?'標記模式':'揭露模式',26,step===1?'#182536':'#fff')+grid(values,3,{x:205,y:78,size:78,highlight:[step===0?0:8]})+(step<2?pointer(step===0?242:398,step===0?115:271):text(320,370,'安全格全部完成 ✓',32,'#70e4ce')));
}
function zero(step) {
  const values=Array(25).fill(9);Object.assign(values,{6:1,7:-1,11:-1,12:1});
  return svg(grid(values,5,{x:165,y:15,size:62,highlight:step>0?[6,7,11,12]:[]})+(step===0?text(320,370,'找總和為 0 的 2×2 方格',26):step===1?text(320,370,'1 − 1 − 1 + 1 = 0',32,'#ffdf70'):confirm('輸入 1 → 確定')));
}
const community=['A♥','K♥','Q♥','2♣'];
const cards=['J♥','10♥','3♣','4♦','5♠','6♥','7♣','8♦','9♠','2♥','3♦','4♠','5♣','6♦','7♠','8♣'];
function poker(step) {
  let content=community.map((v,i)=>rect(138+i*94,12,86,70,'#fff7e9')+text(181+i*94,47,v,30,'#b12c49')).join('');
  if(step===0)content+=text(320,205,'先看這四張公共牌',32)+text(320,260,'再記憶 16 張牌的位置',26,'#a9bed9');
  else {content+=grid(step===1?cards:cards.map((_,i)=>String.fromCharCode(65+i)),4,{x:200,y:98,size:60,highlight:step===2?[0,1,2]:[]});if(step===2)content+=confirm('選 3 張 → 確定');else content+=text(320,370,'記住能搭配公共牌的位置',26);}
  return svg(content);
}
function sequence(step) {
  const values=[1,'',4,'',2,'',5,'',3];
  const labels=values.map(v=>step===0?v:step===2&&v&&v<=2?v:'');
  const colors=values.map(v=>step===0||!v||step===2&&v<=2?'#000':'#fff');
  return svg(rect(188,15,264,264,'#000','#000')+grid(labels,3,{x:194,y:21,size:86,colors})+text(320,330,step===0?'記住 1 → 2 → 3 → 4 → 5':step===1?'白格蓋住數字':'照順序點，從 1 開始',28)+(step===2?pointer(237,64):''));
}
let objectDemo;
function objectViews(step) {
  objectDemo ??= generateObjectQuestion(1, max => max - 1);
  const model = objectDemo.object;
  const graphic = step === 0 ? objectOrthographicSvg(model) : objectPerspectiveSvg(model);
  return svg(`<svg x="80" y="0" width="480" height="320">${graphic}</svg>` +
    (step === 2 ? confirm('選出物件 → 確定') : text(320,365,step === 0 ? '上方是上視圖，右方是右側視圖' : '比對輪廓、圓弧與斜角',25)));
}
function map(step) {
  if(step===0)return svg('<path d="M100 320 L240 160 L400 160 L540 320Z" fill="#203d59" stroke="#8eb4d1" stroke-width="3"/><path d="M180 250 L220 170 L260 250Z" fill="#42c9ff"/>'+rect(380,174,70,76,'#ffc84f')+text(320,365,'前方：左邊藍三角、右邊黃方塊',25));
  return svg(rect(160,20,320,290,'#17344c')+'<path d="M210 150 L240 80 L270 150Z" fill="#42c9ff"/>'+rect(370,80,60,70,'#ffc84f')+text(320,247,'A ↑',40,step===2?'#70e4ce':'#fff')+text(320,55,'B ↓',30)+(step===1?pointer(320,247):confirm('選 A → 確定')));
}
function slither(step) {
  const x=210,y=40,size=110;
  let content='';
  for(let r=0;r<2;r++)for(let c=0;c<2;c++)content+=text(x+c*size+55,y+r*size+55,'2',42);
  const line=(x1,y1,x2,y2)=>`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#70e4ce" stroke-width="9"/>`;
  if(step>0)content+=line(x,y,x+size*2,y)+line(x,y,x,y+size*2);
  if(step===2)content+=line(x,y+size*2,x+size*2,y+size*2)+line(x+size*2,y,x+size*2,y+size*2);
  if(step===1)content+=text(x+size,y+size/2,'×',32,'#e2aa88');
  for(let r=0;r<3;r++)for(let c=0;c<3;c++)content+=`<circle cx="${x+c*size}" cy="${y+r*size}" r="7" fill="#f5f8ff"/>`;
  content+=text(320,345,step===0?'數字 2：周圍要有兩條線':step===1?'點邊：線 → 叉 → 清除':'連成一個封閉圈 ✓',28);
  return svg(content);
}
const stories={
  minesweeper:{steps:['先踩「起」','切換模式插旗','翻開所有安全格'],draw:mine},
  zero_sum_grid:{steps:['找 2×2 方格','四個數字相加為 0','輸入總數，按確定'],draw:zero},
  cube_count:{steps:['看清楚方塊堆疊','分層數，包含遮住的','輸入總數，按確定']},
  solid_puzzle:{steps:['看前、側、上三視圖','找出能填入的零件','點選零件，按確定']},
  memory_poker:{steps:['先看四張公共牌','記憶 16 張牌的位置','蓋牌後選三張，按確定'],draw:poker},
  map_view:{steps:['記住前方景象','比對位置與朝向','點選答案，按確定'],draw:map},
  memory_sequence:{steps:['記住數字與位置','蓋牌後從 1 開始','依序點完全部數字'],draw:sequence},
  slitherlink:{steps:['看數字決定邊數','點邊畫線或打叉','連成一個封閉圈'],draw:slither}
};
export function illustratedTutorial(gameId, config = {}) {
  const story = gameId === 'map_view' && config.questionMode === 'object_views'
    ? {steps:['看 L 型三視圖','比對六個立體物件','點選答案，按確定'],draw:objectViews} : stories[gameId];
  if(!story)throw new Error(`沒有圖解教學：${gameId}`);
  return {steps:[...story.steps],frames:story.steps.map((label,index)=>({label,svg:story.draw?.(index)??null}))};
}
