"""Network-free tests for AI payloads, result validation and secret boundaries."""
import json,os,sys,tempfile,unittest,shutil
from pathlib import Path
from unittest.mock import patch,AsyncMock
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import httpx
from fastapi import HTTPException
from fastapi.testclient import TestClient
from backend.ai import AIService,ChatRequest,validate_plan,request_openai
from backend.server import create_app
CONTEXT={'layers':[{'id':'buildings','kind':'vector','fields':['height'],'count':5306},{'id':'satellite','kind':'raster','fields':[]}]}
class AIUnitTests(unittest.IsolatedAsyncioTestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);(self.root/'config').mkdir();self.env=patch.dict(os.environ,{'OPENAI_API_KEY':'','OPENAI_MODEL':''});self.env.start();self.ai=AIService(self.root,lambda:CONTEXT)
 def tearDown(self):self.env.stop();self.temp.cleanup()
 def key(self):(self.root/'config/local_ai.json').write_text(json.dumps({'api_key':'fake-test-key','model':'gpt-4.1-mini'}))
 async def test_missing_key_never_calls_provider(self):
  with patch('backend.ai.request_openai',new_callable=AsyncMock) as provider:
   with self.assertRaises(HTTPException) as c:await self.ai.run(ChatRequest(message='hello'))
   self.assertEqual(c.exception.status_code,503);provider.assert_not_called();self.assertFalse(self.ai.status()['configured'])
 async def test_bounded_payload_valid_plan_and_secret_redaction(self):
  self.key();plan={'reply':'Select buildings over 50 m.','actions':[{'action':'select','layer':'buildings','field':'height','operator':'gt','value':50}]}
  with patch('backend.ai.request_openai',new_callable=AsyncMock,return_value=plan) as provider:
   r=await self.ai.run(ChatRequest(message='select over 50 m',language='en'))
   self.assertEqual(r['actions'],plan['actions']);payload=provider.call_args.args[1];self.assertFalse(payload['store']);self.assertEqual(payload['max_output_tokens'],1500);self.assertTrue(payload['text']['format']['strict']);self.assertIn('English',payload['instructions']);self.assertNotIn('coordinates',json.dumps(CONTEXT));self.assertNotIn('fake-test-key',json.dumps(r));self.assertNotIn('fake-test-key',json.dumps(self.ai.status()));self.assertTrue(self.ai.status()['verified'])
 async def test_invalid_action_entire_plan_rejected(self):
  self.key()
  with patch('backend.ai.request_openai',new_callable=AsyncMock,return_value={'reply':'','actions':[{'action':'table','layer':'buildings'},{'action':'shell','command':'echo bad'}]}):
   with self.assertRaises(HTTPException):await self.ai.run(ChatRequest(message='hello'))
   self.assertFalse(self.ai.status()['verified'])
 async def test_test_connection_cannot_execute_actions_and_rate_cap(self):
  self.key()
  with patch('backend.ai.request_openai',new_callable=AsyncMock,return_value={'reply':'ok','actions':[]}):
   for i in range(10):await self.ai.run(ChatRequest(message='test'),test=True)
   with self.assertRaises(HTTPException) as c:await self.ai.run(ChatRequest(message='test'),test=True)
   self.assertEqual(c.exception.status_code,429)
 async def test_response_errors_and_no_remote_error_leaks(self):
  for status in [401,403,429,500]:
   client=AsyncMock();client.post.return_value=httpx.Response(status,json={'error':{'message':'fake-test-key'}});client.__aenter__.return_value=client
   with patch('backend.ai.httpx.AsyncClient',return_value=client):
    with self.assertRaises(HTTPException) as c:await request_openai('fake-test-key',{})
    self.assertNotIn('fake-test-key',c.exception.detail)
  for data in [{'status':'incomplete','output':[]},{'status':'completed','output':[{'type':'message','content':[{'type':'refusal','refusal':'no'}]}]}]:
   client=AsyncMock();client.post.return_value=httpx.Response(200,json=data);client.__aenter__.return_value=client
   with patch('backend.ai.httpx.AsyncClient',return_value=client):
    with self.assertRaises(HTTPException):await request_openai('fake-test-key',{})
 async def test_response_wire_format(self):
  client=AsyncMock();client.post.return_value=httpx.Response(200,json={'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':'{"reply":"ok","actions":[]}'}]}]});client.__aenter__.return_value=client
  with patch('backend.ai.httpx.AsyncClient',return_value=client):
   self.assertEqual(await request_openai('fake-test-key',{'store':False}),{'reply':'ok','actions':[]});self.assertEqual(client.post.call_args.args[0],'https://api.openai.com/v1/responses')
 def test_invalid_fields_opacity_and_code(self):
  for action in [{'action':'select','layer':'buildings','field':'year','operator':'gt','value':1990},{'action':'opacity','layer':'buildings','scope':'selected','value':101},{'action':'table','layer':'satellite'},{'action':'select','layer':'buildings','field':'height','operator':'gt','value':'NaN'},{'action':'clear','code':'anything'}]:
   with self.assertRaises(ValueError):validate_plan({'reply':'','actions':[action]},CONTEXT)

class AIEndpointTests(unittest.TestCase):
 def test_routes_local_only_and_no_key_in_status(self):
  root=Path(__file__).resolve().parents[1]
  with tempfile.TemporaryDirectory() as folder,patch.dict(os.environ,{'OPENAI_API_KEY':'','OPENAI_MODEL':''}):
   project=Path(folder);(project/'config').mkdir();shutil.copy2(root/'config/data_catalog.json',project/'config/data_catalog.json')
   with TestClient(create_app(project,root/'dist')) as client:
    self.assertEqual(client.get('/api/ai/status').json()['configured'],False)
    self.assertEqual(client.post('/api/ai/chat',json={'message':'hi'}).status_code,503)
    self.assertEqual(client.post('/api/ai/chat',json={'message':'hi','code':'bad'}).status_code,422)
    self.assertEqual(client.post('/api/ai/test',json={},headers={'Origin':'https://untrusted.example'}).status_code,403)
    self.assertEqual(client.get('/config/local_ai.json').status_code,404)
if __name__=='__main__':unittest.main(verbosity=2)
