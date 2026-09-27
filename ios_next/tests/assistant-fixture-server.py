"""Local-only UI fixture; never uses production credentials or upstream AI.
Launch Debug with CPU_DEBUG_ASSISTANT=1 CPU_APP_URL=http://127.0.0.1:18762.
Messages: 'fail' => HTTP 503; 'disconnect' => truncated SSE; anything else => paced SSE.
POST /control {account: 'fixture-b', fail: true} changes account/network behavior.
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json, time
state = {'account': 'fixture-a', 'fail': False, 'records': {}, 'streams': 0, 'cancelled': 0, 'saves': 0, 'deletes': 0}
page = b'''<!doctype html><meta name="viewport" content="width=device-width"><script>
const probe = async () => {
 const a = await (await fetch('/fixture-auth')).json();
 document.cookie = 'cpu-csrf=fixture-csrf; path=/';
 window.CPUTimeNative.refreshAuth = async () => a;
 window.webkit.messageHandlers.cpuTimeNative.postMessage({type:'authChanged', ...a});
};
setInterval(probe, 500); probe();
</script>Assistant protocol fixture'''
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args): pass
 def respond(self, obj, status=200):
  raw=json.dumps(obj,ensure_ascii=False).encode()
  self.send_response(status); self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(raw))); self.end_headers(); self.wfile.write(raw)
 def body(self):
  return json.loads(self.rfile.read(int(self.headers.get('Content-Length',0))) or '{}')
 def do_GET(self):
  if self.path == '/fixture-auth':
   self.respond({'account':state['account'],'authenticated':True,'ready':True,'canAccessAdmin':False}); return
  if self.path == '/metrics':
   self.respond({k:state[k] for k in ['streams','cancelled','saves','deletes']}); return
  if self.path.startswith('/api/search/assistant/conversations'):
   self.respond({'code':0,'data':list(state['records'].get(state['account'],{}).values())}); return
  if self.path.startswith('/api/'):
   self.respond({'code':0,'data':{}}); return
  self.send_response(200); self.send_header('Content-Type','text/html'); self.send_header('Set-Cookie','cpu-session=local-fixture; HttpOnly; Path=/'); self.end_headers(); self.wfile.write(page)
 def do_POST(self):
  body=self.body()
  if self.path == '/control':
   state.update({k:v for k,v in body.items() if k in ['account','fail']}); self.respond({'ok':True}); return
  if self.headers.get('X-CSRF-Token') != 'fixture-csrf': self.respond({'message':'fixture CSRF failed'},403); return
  message=body.get('message','')
  if state['fail'] or 'fail' in message.lower(): self.respond({'message':'测试网络失败，请重试。'},503); return
  state['streams']+=1
  self.send_response(200); self.send_header('Content-Type','text/event-stream; charset=utf-8'); self.end_headers()
  def event(name,payload):
   self.wfile.write(('event: '+name+'\r\ndata: '+json.dumps(payload,ensure_ascii=False)+'\r\n\r\n').encode()); self.wfile.flush()
  try:
   event('status',{'elapsedMs':0})
   chunks=['这是本机协议验证回复。\n\n','支持中文、emoji 🌱 与分段输出。\n\n'] + [f'{i}. 原生消息随流更新，向上滚动可阅读已经生成的内容。\n\n' for i in range(1,9)]
   for chunk in chunks:
    time.sleep(2); event('delta',{'delta':chunk})
    if 'disconnect' in message.lower(): return
   event('done',{'answer':''.join(chunks),'actions':[{'id':'fixture','label':'校园服务','description':'本机测试入口','url':'/services','icon':'🌱','owner':'测试','requireLogin':True}],'suggestions':[],'fallback':False})
  except (BrokenPipeError,ConnectionResetError): state['cancelled']+=1
 def do_PATCH(self):
  body=self.body()
  if state['fail']: self.respond({'message':'fixture offline'},503); return
  if self.headers.get('X-CSRF-Token') != 'fixture-csrf': self.respond({'message':'fixture CSRF failed'},403); return
  for m in body.get('messages',[]):
   for action in m.get('actions',[]):
    if 'owner' not in action: self.respond({'message':'missing owner'},400); return
  body['id']=self.path.rsplit('/',1)[-1]
  state['records'].setdefault(state['account'],{})[body['id']]=body; state['saves']+=1
  self.respond({'code':0,'data':body})
 def do_DELETE(self):
  if state['fail']: self.respond({'message':'fixture offline'},503); return
  key=self.path.rsplit('/',1)[-1]; records=state['records'].setdefault(state['account'],{})
  record=records.get(key,{'id':key,'title':'deleted','messages':[],'updatedAt':0}); record['deletedAt']=int(time.time()*1000); records[key]=record
  state['deletes']+=1; self.respond({'code':0,'data':{'deletedAt':record['deletedAt']}})
ThreadingHTTPServer(('127.0.0.1',18762),Handler).serve_forever()
