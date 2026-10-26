import {createRequire} from 'node:module'
const root='/home/zhangyangrui/my_programes/dsh-tui'
const upstream='/home/zhangyangrui/my_programes/deepseek-harness'
const require=createRequire(upstream+'/package.json')
const {default:tsconfigPaths}=await import(require.resolve('vite-tsconfig-paths'))
const ts=require('typescript')
const fs=require('node:fs')
const paths=ts.parseConfigFileTextToJson(upstream+'/tsconfig.base.json',fs.readFileSync(upstream+'/tsconfig.base.json','utf8')).config.compilerOptions.paths
const aliases=Object.entries(paths).filter(([name])=>!name.includes('*') && !['@deepseek-ai/dsh-tui-render','@deepseek-ai/dsh-tui'].includes(name)).map(([name,targets])=>({find:new RegExp('^'+name+'$'),replacement:upstream+'/'+targets[0]}))
const {standardDecoratorPlugin,vitestExecArgv}=await import(upstream+'/vitest.shared.ts')
export default {
 root,
 cacheDir:'/tmp/dsh-composer-phase5/vite-cache',
 plugins:[standardDecoratorPlugin(),tsconfigPaths({projects:[upstream+'/tsconfig.base.json']})],
 resolve:{alias:[{find:/^@deepseek-ai\/dsh-tui$/,replacement:root+'/tui/src/index.ts'},{find:/^@deepseek-ai\/dsh-tui-render$/,replacement:root+'/tui-render/src/index.ts'},...aliases]},
 test:{include:['tui/tests/**/*.spec.{ts,tsx}','tui-render/tests/**/*.spec.{ts,tsx}'],pool:'threads',maxWorkers:2,execArgv:vitestExecArgv,testTimeout:15000,hookTimeout:30000}
}
