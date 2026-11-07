import json,tarfile,pathlib,hashlib
root=pathlib.Path('.')
archive=tarfile.open('C:/Users/nekot/Documents/FlowDoc-recovery/full-uat-srs-direct-fonts4-20261106/lab/candidate.tar.gz')
fixture=json.load(archive.extractfile('lab-full/font-fixture.json'))
(root/'fixtures/font-fixture.json').write_text(json.dumps(fixture),encoding='utf8')
for face in fixture['faces']:
 data=archive.extractfile('lab-full/fonts/'+face['sha256']).read();assert hashlib.sha256(data).hexdigest()==face['sha256']
 (root/'public'/('font-'+str(face['weight'])+'.ttf')).write_bytes(data)
lic=archive.extractfile('lab-full/fonts/'+fixture['licenseHash']).read();(root/'public/OFL.txt').write_bytes(lic)
bundle=json.load(open('C:/Users/nekot/Documents/FlowDoc-recovery/pack-055-20261106/inputs/uat-full.json',encoding='utf8'))
t=bundle['template'];r=bundle['request']
t['sections'][0].pop('header');t['sections'][0].pop('footer')
t['globalSchema']={'type':'object','fields':{}}
t['areaFormats']={'summary-dynamic':t['areaFormats']['summary-dynamic']}
f=r['sections'][0]['data']['parts'][8]
seed=f['data']['groups'][0]['members'][0]
f['data']['groups'][0]['members']=[dict(seed) for _ in range(34)]
f['data']['totals']=[]
r['data']={};r['sections'][0]['data']['parts']=[f]
r['docKey']=t['docKey'];r['version']=t['version']
for name,value in [('template',t),('request',r)]:
 (root/'public'/('spike-'+name+'.json')).write_text(json.dumps(value,ensure_ascii=False),encoding='utf8')
