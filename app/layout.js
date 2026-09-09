import './globals.css'
import AppProviders from '@/components/providers/AppProviders'
import { THEMES, THEME_VARS, THEME_STORAGE_KEY, CUSTOM_THEME_ID, CUSTOM_THEME_STORAGE_KEY } from '@/lib/themes'
import { FONT_GROUPS, MONO_FONTS, TYPOGRAPHY_STORAGE_KEY, UI_FONTS } from '@/lib/typography'

export const metadata = {
  title: 'HyperFamily Branch Monitor',
  description: 'Secure retail branch and device monitoring'
}

/**
 * Theme palettes, reduced to just what the boot script needs and inlined into
 * the document. Reading the database is asynchronous and only possible after
 * sign-in, so without this the login screen always painted in the default
 * theme and only switched after the user was authenticated.
 */
const BOOT_THEMES = Object.fromEntries(
  THEMES.map((theme) => [
    theme.id,
    { m: theme.mode, v: THEME_VARS.map((key) => theme[key]) }
  ])
)

/**
 * Font id → CSS stack lookups for the boot script, and the variable names each
 * group writes, so the cached typography can be restored without importing the
 * module at runtime.
 */
const BOOT_FONTS = {
  ui: Object.fromEntries(UI_FONTS.filter((font) => font.id).map((font) => [font.id, font.stack])),
  mono: Object.fromEntries(MONO_FONTS.map((font) => [font.id, font.stack]))
}
const BOOT_GROUPS = FONT_GROUPS.map((group) => ({ i: group.id, v: group.variable, s: group.sizeVariable, m: group.id === 'mono' }))

/**
 * Runs before the first paint: restores the theme and the typography the user
 * last chose, so every screen — the login page included — opens in the right
 * colours and at the right scale with no flash. Written as a string because it
 * must execute synchronously in the document head, ahead of React hydration.
 */
const BOOT_SCRIPT = `(function(){try{
var T=${JSON.stringify(BOOT_THEMES)},K=${JSON.stringify(THEME_VARS)};
var id=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
var r=document.documentElement,t=null,name=id&&T[id]?id:${JSON.stringify(THEMES[0].id)};
if(id===${JSON.stringify(CUSTOM_THEME_ID)}){
/* The custom palette is not in the compiled table: read the mirrored copy and
   derive its light/dark mode from the canvas luminance, exactly as
   lib/themes.js does, so native scrollbars match from the very first paint. */
var raw=localStorage.getItem(${JSON.stringify(CUSTOM_THEME_STORAGE_KEY)});
if(raw){var c=JSON.parse(raw),v=[];
for(var k=0;k<K.length;k++)v.push(c[K[k]]||T[${JSON.stringify(THEMES[0].id)}].v[k]);
var p=String(c.canvas||'0 0 0').split(/\s+/).map(Number);
var lum=function(x){x=(Number(x)||0)/255;return x<=0.03928?x/12.92:Math.pow((x+0.055)/1.055,2.4)};
t={m:(0.2126*lum(p[0])+0.7152*lum(p[1])+0.0722*lum(p[2])>0.4)?'light':'dark',v:v};
name=${JSON.stringify(CUSTOM_THEME_ID)};}
}
if(!t)t=(id&&T[id])||T[${JSON.stringify(THEMES[0].id)}];
if(!t)return;
for(var i=0;i<K.length;i++)r.style.setProperty('--'+K[i],t.v[i]);
r.style.colorScheme=t.m;r.dataset.theme=name;r.dataset.colorMode=t.m;
}catch(e){}
try{
var F=${JSON.stringify(BOOT_FONTS)},G=${JSON.stringify(BOOT_GROUPS)};
var raw=localStorage.getItem(${JSON.stringify(TYPOGRAPHY_STORAGE_KEY)});
if(!raw)return;
var cfg=JSON.parse(raw),el=document.documentElement;
for(var j=0;j<G.length;j++){
var g=G[j],fam=cfg['font_'+g.i+'_family'],st=fam?(g.m?F.mono[fam]:F.ui[fam]||F.mono[fam]):'';
if(st)el.style.setProperty(g.v,st);
var sz=Number(cfg['font_'+g.i+'_size']);
if(sz>=50&&sz<=200)el.style.setProperty(g.s,String(sz/100));
}
}catch(e){}})()`

/**
 * The Tauri IPC bridge. Exposes the EXACT same window.hyperfamily surface as
 * electron/preload/index.js — every channel name, every call signature and
 * every subscribe() unsubscribe function — so lib/api.js and the whole
 * component tree run unmodified. Written as a script string so it is defined
 * before any module code runs.
 *
 * Tauri commands take a single `payload` argument; the shim packs positional
 * arguments the way the Electron renderer passed them (id, limit, mode, ...).
 */
const BRIDGE_SCRIPT = `(function(){
var T=window.__TAURI__;if(!T||!T.core)return;
var invoke=function(channel,payload){return T.core.invoke(channel,{payload:payload===undefined?null:payload})};
var subscribe=function(channel,callback){
var unlisten=null,alive=true;
T.event.listen(channel,function(event){if(alive)callback(event.payload)}).then(function(fn){unlisten=fn;if(!alive)fn()});
return function(){alive=false;if(unlisten)unlisten()}};
var api={
platform:'tauri',
auth:{
login:function(payload){return invoke('auth:login',payload)},
status:function(){return invoke('auth:status')},
logout:function(){return invoke('auth:logout')},
updateCredentials:function(payload){return invoke('auth:update-credentials',payload)},
changePassword:function(payload){return invoke('auth:change-password',payload)},
recoverStatus:function(){return invoke('auth:recover-status')},
recover:function(pin){return invoke('auth:recover',{pin:pin})},
setRecoveryPin:function(pin){return invoke('auth:set-recovery-pin',{pin:pin})},
rememberCredentials:function(payload){return invoke('auth:remember-credentials',payload)},
rememberedCredentials:function(){return invoke('auth:remembered-credentials')}
},
branches:{list:function(){return invoke('branches:list')},save:function(payload){return invoke('branches:save',payload)},remove:function(id){return invoke('branches:remove',id)},removeAll:function(){return invoke('branches:remove-all')}},
devices:{list:function(){return invoke('devices:list')},save:function(payload){return invoke('devices:save',payload)},remove:function(id){return invoke('devices:remove',id)}},
monitor:{snapshot:function(){return invoke('monitor:snapshot')},subscribe:function(callback){return subscribe('monitor:update',callback)}},
settings:{get:function(){return invoke('settings:get')},save:function(patch){return invoke('settings:save',patch)}},
credentials:{
list:function(){return invoke('credentials:list')},
reveal:function(id){return invoke('credentials:reveal',id)},
save:function(payload){return invoke('credentials:save',payload)},
remove:function(id){return invoke('credentials:remove',id)},
mappings:function(){return invoke('credentials:mappings')},
map:function(){return invoke('credentials:credential-map')},
forDevice:function(deviceId){return invoke('credentials:for-device',deviceId)},
saveMappings:function(mappings){return invoke('credentials:save-mappings',mappings)},
overview:function(){return invoke('credentials:overview')},
assignDevice:function(deviceId,credentialId){return invoke('credentials:assign-device',{deviceId:deviceId,credentialId:credentialId})},
assignType:function(deviceType,credentialId){return invoke('credentials:assign-type',{deviceType:deviceType,credentialId:credentialId})}
},
inventory:{list:function(){return invoke('inventory:list')},export:function(filters){return invoke('inventory:export',filters)}},
directory:{template:function(){return invoke('directory:template')},import:function(){return invoke('directory:import')}},
remote:{
connect:function(payload){return invoke('remote:connect',payload)},
probe:function(){return invoke('remote:probe')},
palette:function(palette){return invoke('remote:palette',palette)}
},
terminal:{
targets:function(){return invoke('terminal:targets')},
open:function(payload){return invoke('terminal:open',payload)},
write:function(payload){return invoke('terminal:write',payload)},
resize:function(payload){return invoke('terminal:resize',payload)},
close:function(sessionId){return invoke('terminal:close',sessionId)},
onData:function(callback){return subscribe('terminal:data',callback)},
onStatus:function(callback){return subscribe('terminal:status',callback)}
},
snippets:{list:function(){return invoke('snippets:list')},save:function(payload){return invoke('snippets:save',payload)},remove:function(id){return invoke('snippets:remove',id)}},
notes:{list:function(){return invoke('notes:list')},save:function(payload){return invoke('notes:save',payload)},remove:function(id){return invoke('notes:remove',id)}},
vpn:{
status:function(){return invoke('vpn:status')},
probe:function(){return invoke('vpn:probe')},
connect:function(mode){return invoke('vpn:connect',mode)},
disconnect:function(){return invoke('vpn:disconnect')},
diagnose:function(){return invoke('vpn:diagnose')},
subscribe:function(callback){return subscribe('vpn:status',callback)}
},
update:{
check:function(){return invoke('update:check')},
state:function(){return invoke('update:state')},
download:function(){return invoke('update:download')},
pause:function(){return invoke('update:pause')},
resume:function(){return invoke('update:resume')},
stop:function(){return invoke('update:stop')},
install:function(){return invoke('update:install')},
subscribe:function(callback){return subscribe('update:event',callback)}
},
storeUpdate:{
importAgent:function(payload){return invoke('store-update:import-agent',payload)},
importAgentAll:function(payload){return invoke('store-update:import-agent-all',payload)},
onAgentStep:function(callback){return subscribe('store-update:agent-step',callback)},
version:function(payload){return invoke('store-update:version',payload)},
versions:function(payload){return invoke('store-update:versions',payload)},
deploy:function(payload){return invoke('store-update:deploy',payload)},
deployAll:function(payload){return invoke('store-update:deploy-all',payload)},
testAccess:function(payload){return invoke('store-update:test-access',payload)},
installed:function(payload){return invoke('store-update:installed',payload)},
onVersion:function(callback){return subscribe('store-update:version',callback)},
onStep:function(callback){return subscribe('store-update:step',callback)},
onProgress:function(callback){return subscribe('store-update:progress',callback)},
onFinished:function(callback){return subscribe('store-update:finished',callback)}
},
audit:{list:function(limit){return invoke('audit:list',limit)}},
dialog:{
selectFile:function(options){return invoke('dialog:select-file',options)},
selectFiles:function(options){return invoke('dialog:select-files',options)},
selectDirectory:function(options){return invoke('dialog:select-directory',options)}
},
app:{info:function(){return invoke('app:info')},openExternal:function(url){return invoke('app:open-external',url)},pathExists:function(path){return invoke('app:path-exists',path)}}
};
window.hyperfamily=api;
window.dispatchEvent(new Event('hyperfamily:bridge-ready'));
})()`

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: BRIDGE_SCRIPT }} />
      </head>
      <body><AppProviders>{children}</AppProviders></body>
    </html>
  )
}
