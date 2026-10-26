"""Fixture-only V8 snapshot attribution; shallow sizes are not retained sizes."""
import json, sys, gzip
from collections import Counter, deque
from pathlib import Path
p=Path(sys.argv[1]); d=json.load(gzip.open(p,'rt') if p.suffix=='.gz' else p.open()); m=d['snapshot']['meta']; n=d['nodes']; e=d['edges']; strings=d['strings']; nf=m['node_fields']; ef=m['edge_fields']; ns=len(nf); es=len(ef)
nt=m['node_types'][nf.index('type')]; et=m['edge_types'][ef.index('type')]
ni={k:nf.index(k) for k in nf}; ei={k:ef.index(k) for k in ef}
count=len(n)//ns; starts=[]; off=0; targets=[]; classes=Counter(); sizes=Counter()
for b in range(0,len(n),ns):
 starts.append(off); off+=n[b+ni['edge_count']]*es
def string_value(to, depth=0):
 if depth>32:return ''
 typ=nt[n[to+ni['type']]]
 if typ=='concatenated string':
  pieces=[]
  for pos in range(starts[to//ns], starts[to//ns]+n[to+ni['edge_count']]*es,es):
   kind=et[e[pos+ei['type']]];label=e[pos+ei['name_or_index']]
   if kind=='internal' and strings[label] in ('first','second'):pieces.append(string_value(e[pos+ei['to_node']],depth+1))
  return ''.join(pieces)
 return strings[n[to+ni['name']]]
off=0
for ix in range(count):
 b=ix*ns; name=strings[n[b+ni['name']]]; typ=nt[n[b+ni['type']]]
 if typ=='object': classes[name]+=1; sizes[name]+=n[b+ni['self_size']]
 for pos in range(off,off+n[b+ni['edge_count']]*es,es):
  kind=et[e[pos+ei['type']]]; label=e[pos+ei['name_or_index']]; to=e[pos+ei['to_node']]
  if kind=='property' and strings[label]=='text':
   value=string_value(to)
   if value.startswith('HISTORY_0 '): targets.append(ix)
 off+=n[b+ni['edge_count']]*es
parents=[[] for _ in range(count)]
for ix in range(count):
 b=ix*ns
 for pos in range(starts[ix],starts[ix]+n[b+ni['edge_count']]*es,es):
  kind=et[e[pos+ei['type']]]
  if kind=='weak': continue
  label=e[pos+ei['name_or_index']]; label=strings[label] if kind not in ('element','hidden') else str(label)
  parents[e[pos+ei['to_node']]//ns].append((ix,kind,label))
loc={}
lf=m.get('location_fields',[]);ls=len(lf)
if ls:
 for i in range(0,len(d.get('locations',[])),ls):
  entry=dict(zip(lf,d['locations'][i:i+ls]));loc[entry['object_index']//ns]=entry
paths=[]
for target in targets:
 q=deque([target]); seen={target}; nexts={}; found=None
 while q:
  cur=q.popleft()
  if cur==0: found=cur; break
  for parent,kind,label in parents[cur]:
   if parent in seen: continue
   seen.add(parent); nexts[parent]=(cur,kind,label); q.append(parent)
 if found is not None:
  path=[]; cur=0
  while cur!=target:
   to,kind,label=nexts[cur]; path.append({'from':strings[n[cur*ns+ni['name']]],'edge':kind+':'+label,'to':strings[n[to*ns+ni['name']]],'fromLocation':loc.get(cur),'toLocation':loc.get(to)});cur=to
  paths.append(path)
selected=['HistoryRowCache','HistoryOverlay','ExactHistoryWindow','TranscriptRenderStoreImpl','MarkdownProjectorState','MutableRevisionImpl','Object','Array']
result={'snapshot':str(p),'totalNodes':count,'totalShallowBytes':sum(n[i+ni['self_size']] for i in range(0,len(n),ns)), 'classes':{k:{'instances':classes[k],'shallowBytes':sizes[k]} for k in selected},'oldestCanonicalObjects':len(targets),'oldestStrongRootPaths':paths,'method':'V8 class/shallow counts and shortest root paths excluding weak edges; not dominator retained-size measurement'}
print(json.dumps(result,ensure_ascii=False,indent=2))
