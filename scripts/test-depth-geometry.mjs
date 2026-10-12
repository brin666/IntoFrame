import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const compile = path => ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const parallaxUrl=moduleUrl(compile('src/parallax.ts'));
const geometry=await import(moduleUrl(compile('src/depthGeometry.ts').replaceAll('"./parallax"',JSON.stringify(parallaxUrl))));
const parallax=await import(parallaxUrl);
const width=65,height=49;
const raw=Float32Array.from({length:width*height},(_,i)=>0.15+0.7*(i%width)/(width-1)+0.15*Math.floor(i/width)/(height-1));
const metadata={width,height,encoding:'float32-little-endian-row-major',subjectP05:0.15,subjectP95:0.95,subjectMedian:0.55,globalP02:0.11,globalP98:0.98,globalMin:0.1,globalMax:1};
const bytes=new ArrayBuffer(raw.length*4),view=new DataView(bytes);
raw.forEach((value,index)=>view.setFloat32(index*4,value,true));
assert.deepEqual(geometry.decodeMeshDepth(bytes,metadata,width,height),raw);
assert.throws(()=>geometry.decodeMeshDepth(bytes.slice(0,-4),metadata,width,height));
const corrupt=bytes.slice(0);new DataView(corrupt).setFloat32(0,NaN,true);
assert.throws(()=>geometry.decodeMeshDepth(corrupt,metadata,width,height));
assert.throws(()=>geometry.decodeMeshDepth(bytes,{...metadata,subjectP05:0.549,subjectP95:0.551},width,height));
const surface=geometry.createDepthSurface(raw,metadata,0.65,new Uint8Array(raw.length).fill(255));
const native=geometry.createPhotoGeometryData(surface,width/height);
const padded=geometry.createPhotoGeometryData(surface,width/height,{left:7,right:11,top:5,bottom:9});
const focal=600/(2*Math.tan(parallax.FOV*Math.PI/360));
const viewportWidth=600*width/height;
let maximumCenterError=0;
const motions=[];
for(const data of [native,padded]) {
  assert.equal(data.indices.length%6,0);
  assert.equal(new Set(data.indices).size,data.positions.length/3,'Every full-grid vertex remains covered; no dropped silhouettes');
  for(let i=0;i<data.positions.length/3;i++){
    const x=data.positions[i*3],y=data.positions[i*3+1],z=data.positions[i*3+2];
    const px=data.sourceCoordinates[i*2],py=data.sourceCoordinates[i*2+1];
    const screenX=viewportWidth/2+focal*x/(parallax.CAMERA_DISTANCE-z);
    const screenY=300-focal*y/(parallax.CAMERA_DISTANCE-z);
    maximumCenterError=Math.max(maximumCenterError,Math.abs(screenX-px/width*viewportWidth),Math.abs(screenY-py/height*600));
    assert.ok(Number.isFinite(screenX+screenY));
    if(data===native) motions.push(-focal*0.02/(parallax.CAMERA_DISTANCE-z));
  }
}
assert.ok(maximumCenterError<0.001,`Exact centered projection drift ${maximumCenterError}`);
const localMotionSpread=Math.max(...motions)-Math.min(...motions);
assert.ok(localMotionSpread>1,'A fixed camera gives materially different local pixel motion, beyond rigid translation');
const shared=new Map();
for(let i=0;i<native.positions.length/3;i++)shared.set(`${native.sourceCoordinates[i*2]},${native.sourceCoordinates[i*2+1]}`,Array.from(native.positions.slice(i*3,i*3+3)));
for(let i=0;i<padded.positions.length/3;i++){
  const key=`${padded.sourceCoordinates[i*2]},${padded.sourceCoordinates[i*2+1]}`;
  if(shared.has(key))assert.deepEqual(Array.from(padded.positions.slice(i*3,i*3+3)),shared.get(key),'Subject and retained scene share exact contact geometry');
}
const travel=parallax.calculateParallax({width:viewportWidth,height:600,zoom:1,shiftX:0,sourceWidth:width,paddingX:7,subjectBounds:[0,0,width,height],subjectStats:{occupancy:.5,leftEdgeFraction:1,rightEdgeFraction:1},foregroundDepth:.65,touch:false,travelScale:1,subjectReferenceZ:surface.referenceZ,nearestZ:surface.nearestZ,cameraAdvance:.035});
assert.equal(travel.leftTravel,0);assert.equal(travel.rightTravel,0);
console.log(JSON.stringify({status:'passed',checks:9,maximumCenterErrorCssPx:maximumCenterError,localMotionSpreadCssPxAtSameCamera:localMotionSpread,reliefSpan:surface.nearestZ-surface.farthestZ}));
