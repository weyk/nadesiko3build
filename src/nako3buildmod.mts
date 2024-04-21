/**
 * コマンドライン版のなでしこ3をモジュールとして定義
 * 実際には nako3build.mjs から読み込まれる
 */
import fs from 'fs'
import fsp from 'node:fs/promises'
import fse from 'fs-extra'
import { exec } from 'child_process'
import path from 'path'

import { NakoCompiler, LoaderTool, newCompilerOptions } from 'nadesiko3/core/src/nako3.mjs'
import { NakoImportError } from 'nadesiko3/core/src/nako_errors.mjs'

import { Ast, CompilerOptions } from 'nadesiko3/core/src/nako_types.mjs'
import { NakoGlobal } from 'nadesiko3/core/src/nako_global.mjs'
import nakoVersion from 'nadesiko3/src/nako_version.mjs'

import PluginNode from 'nadesiko3/src/plugin_node.mjs'
import PluginBrowser from 'nadesiko3/src/plugin_browser.mjs'
import PluginBrowserInWorker from 'nadesiko3/src/plugin_browser_in_worker.mjs'
// @ts-ignore
import PluginWorker from 'nadesiko3/src/plugin_worker.mjs'

import app from 'nadesiko3/src/commander_ja.mjs'

import { NakoGenOptions } from 'nadesiko3/core/src/nako_gen.mjs'

// __dirname のために
import url from 'url'
const __filename = url.fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)


const srcDir:{'src':string,'coresrc':string, 'nakorelease':string, 'release':string} = {
  'src': path.join(__dirname, '..', 'node_modules', 'nadesiko3', 'src'),
  'coresrc': path.join(__dirname, '..', 'node_modules', 'nadesiko3', 'core', 'src'),
  'nakorelease': path.join(__dirname, '..', 'node_modules', 'nadesiko3', 'release'),
  'release': path.join(__dirname, '..', 'release')
}

type StandAloneFiles = {
  fromDir: keyof typeof srcDir
  commonFiles:string[]|null
  nodeFiles:string[]|null
  webFiles:string[]|null
  webworkerFiles:string[]|null
}

type TargetKey = keyof StandAloneFiles

const standalone_files:StandAloneFiles[] = [
  {
    fromDir: 'src',
    commonFiles: ['nako_version.mjs'],
    nodeFiles: null,
    webFiles: null,
    webworkerFiles: ['plugin_browser_in_worker.mjs', 'plugin_worker.mjs']
  },
  {
    fromDir: 'coresrc',
    commonFiles: [
      'nako_core_version.mjs', 'nako_errors.mjs',
      'plugin_system.mjs', 'plugin_math.mjs', 'plugin_promise.mjs',
      'plugin_test.mjs', 'plugin_csv.mjs', 'nako_csv.mjs'],
    nodeFiles: null,
    webFiles: null,
    webworkerFiles: null
  },
  {
    fromDir: 'release',
    commonFiles: null,
    nodeFiles: ['plugin_node.mjs'],
    webFiles: ['plugin_browser.js'],
    webworkerFiles: null
  }
]

// Webpackでplugin_nodeにまとめる場合はnodeFilesは不要になる。
// Webpackでplugin_browserにまとめる場合はwebFilesは不要になる。
// 上記のどちらも不要であればnullとすることが可能
const standalone_modules: null|StandAloneFiles = null
/*
{
  fromDir: 'modules',
  commonFiles: null,
  nodeFiles: ['fs-extra', 'iconv-lite', 'opener', 'node-fetch', 'shell-quote'],
  webFiles: ['hotkeys-js'],
  webworkerFiles: null
}
*/

/** コマンドラインアクション */
interface Nako3BuildArgOptions {
  warn: boolean
  debug: boolean
  compile: any | boolean
  test: any | boolean
  one_liner: any | boolean
  trace: any | boolean
  source: any | string
  mainfile: any | string
  man: string
  browsers: boolean
  generator: string
  plugin: string | string[]
  ast: boolean
  lex: boolean
  web: boolean
  webworker: boolean
}

interface Nako3BuildOptions {
  nostd: boolean
}

/** Nako3Build */
export class Nako3Build extends NakoCompiler {
  debug: boolean
  version: string
  pluginstd: boolean

  constructor (opts:Nako3BuildOptions = { nostd: false }) {
    super({ useBasicPlugin: !opts.nostd })
    this.debug = false
    this.pluginstd = !opts.nostd
    this.filename = 'main.nako3'
    this.version = nakoVersion.version
    // 必要な定数を設定
    this.addListener('beforeRun', (g: NakoGlobal) => {
      g.__varslist[0]['ナデシコ種類'] = 'nako3build'
      g.__varslist[0]['ナデシコバージョン'] = this.version
    })
  }

  // Nako3Buildで使えるコマンドを登録する
  registerCommands () {
    // コマンド引数がないならば、ヘルプを表示(-hはcommandarにデフォルト用意されている)
    if (process.argv.length <= 2) { process.argv.push('-h') }

    const verInfo = `v${nakoVersion.version}`
    // commanderを使って引数を解析する
    app
      .title('日本語プログラミング言語「なでしこ」' + verInfo)
      .version(verInfo, '-v, --version')
      .usage('[オプション] 入力ファイル.nako3')
      .option('-h, --help', 'コマンドの使い方を表示')
      .option('-w, --warn', '警告を表示する')
      .option('-d, --debug', 'デバッグモードの指定')
      .option('-D, --trace', '詳細デバッグモードの指定')
      .option('-c, --compile', 'コンパイルモードの指定')
      .option('-t, --test', 'コンパイルモードの指定 (テスト用コードを出力)')
      .option('-e, --eval [src]', '直接プログラムのソースコードを指定')
      .option('-o, --output', '出力ファイル名の指定')
      .option('-s, --silent', 'サイレントモードの指定')
      .option('-b, --browsers', '対応機器/Webブラウザを表示する')
      .option('-m, --man [command]', 'マニュアルを表示する')
      .option('-p, --speed', 'スピード優先モードの指定')
      .option('-g, --generator [file]', '指定したファイルをGeneratorとして取り込む')
      .option('-W, --web', 'ブラウザ用の基本pluginを指定')
      .option('-WW, --webworker', 'Webワーカー用の基本pluginを指定')
      .option('-P, --plugin [plugin...]', '指定したファイルをJS形式のプラグインとして取り込む')
      .option('-A, --ast', '構文解析した結果をASTで出力する')
      .option('-X, --lex', '字句解析した結果をJSONで出力する')
      // .option('-h, --help', '使い方を表示する')
      // .option('-v, --version', 'バージョンを表示する')
      .parse(process.argv)
    return app
  }

  /** コマンドライン引数を解析 */
  checkArguments (): Nako3BuildArgOptions {
    const app: any = this.registerCommands()

    let logLevel = 'error'
    if (app.trace) {
      logLevel = 'trace'
    } else if (app.debug) {
      logLevel = 'debug'
    } else if (app.warn) {
      logLevel = 'warn'
    }
    this.getLogger().addListener(logLevel, ({ level, nodeConsole }) => {
      console.log(nodeConsole)
    })

    const args: any = {
      compile: app.compile || false,
      source: app.eval || '',
      man: app.man || '',
      one_liner: app.eval || false,
      debug: this.debug || false,
      trace: app.trace,
      warn: app.warn,
      test: app.test || false,
      browsers: app.browsers || false,
      generator: app.generator || '',
      plugin: app.plugin || [],
      speed: app.speed || false,
      ast: app.ast || false,
      lex: app.lex || false,
      web: app.web || false,
      webworker: app.webworker || false
    }
    args.mainfile = app.args[0]
    args.output = app.output

    // todo: ESModule 対応の '.mjs' のコードを吐くように修正 #1217
    const ext = '.mjs'
    if (/\.(nako|nako3|txt|bak)$/.test(args.mainfile)) {
      if (!args.output) {
        if (args.test) {
          args.output = args.mainfile.replace(/\.(nako|nako3)$/, '.spec' + ext)
        } else {
          args.output = args.mainfile.replace(/\.(nako|nako3)$/, ext)
        }
      }
    } else {
      if (!args.output) {
        if (args.test) {
          args.output = args.mainfile + '.spec' + ext
        } else {
          args.output = args.mainfile + ext
        }
      }
      args.mainfile += '.nako3'
    }
    return args
  }

  // 実行する
  async execCommand () {
    // コマンドを解析
    const opt: Nako3BuildArgOptions = this.checkArguments()
    // 使い方の表示か？
    if (opt.man) {
      this.cnakoMan(opt.man)
      return
    }
    // 対応ブラウザを表示する
    if (opt.browsers) {
      this.cnakoBrowsers()
      return
    }

    if (this.pluginstd) {
      if (opt.web) {
        this.addPluginFile('PluginBrowser', path.join(__dirname, 'plugin_browser.mjs'), PluginBrowser)
      } else
      if (opt.webworker) {
        this.addPluginFile('PluginBrowserInWorker', path.join(__dirname, 'plugin_browser_in_worker.mjs'), PluginBrowserInWorker)
        this.addPluginFile('PluginWorker', path.join(__dirname, 'plugin_worker.mjs'), PluginWorker)
      } else {
        this.addPluginFile('PluginNode', path.join(__dirname, 'plugin_node.mjs'), PluginNode)
      }
    }

    if (opt.generator) {
      await this.addGenerator(opt.generator)
    }

    if (typeof opt.plugin === 'string') {
      opt.plugin = opt.plugin.split(",")

      let causeError = false
      for (const plugin of opt.plugin) {
        const pluginPath = Nako3Build.findJSPluginFile(plugin, this.filename, __dirname, [], opt.web || opt.webworker)
        if (pluginPath !== '') {
          const pluginModule = await import(`file://${pluginPath}`)
          this.addPluginFile(plugin, pluginPath, pluginModule.default)
        } else {
          console.error(`指定されたプラグインがみつかりませんでした:${plugin}`)
          causeError = true
        }
      }
      if (causeError) {
        process.exit(1)
      }
    }

    // メインプログラムを読み込む
    this.filename = opt.one_liner ? 'main.nako3' : opt.mainfile
    const src = opt.one_liner ? opt.source : fs.readFileSync(opt.mainfile, 'utf-8')
    if (opt.compile) {
      await this.nakoCompile(opt, src, false)
      return
    }
    // 字句解析の結果をJSONで出力
    if (opt.lex) {
      const lex = this.lex(src, opt.mainfile)
      console.log(this.outputJSON(lex, 0))
      return
    }
    // ASTを出力する
    if (opt.ast) {
      try {
        await this.loadDependencies(src, opt.mainfile, '')
      } catch (err: any) {
        if (this.numFailures > 0) {
          this.logger.error(err)
          process.exit(1)
        }
      }
      this.outputAST(opt, src)
      return
    }

    console.log('本コマンドはビルド専用です。ソースを直接実行する場合はcnako3/wnako3を利用してください。')
  }

  /**
   * コンパイルモードの場合
   */
  async nakoCompile (opt: any, src: string, isTest: boolean) {
    // 依存ライブラリなどを読み込む
    await this.loadDependencies(src, this.filename, '')
    // JSにコンパイル
    const basePlugin = opt.webworker ? ['plugin_browser_in_worker.mjs', 'plugin_worker.mjs']: [opt.web ? 'plugin_browser.js' : 'plugin_node.mjs']
    const genOpt = new NakoGenOptions(
      isTest,
      [...opt.plugin, ...basePlugin],
      'self.__varslist[0][\'ナデシコ種類\']=\''+(opt.web ? 'wnako3' : opt.webworker ? 'wwnako3' : 'cnako3' )+'\';'
    )

    const jscode = this.compileStandalone(src, this.filename, genOpt)
    if (opt.web || opt.webworker) {
      opt.output = opt.output.replace(/\.mjs$/, ".js")
    }
    console.log(opt.output)
    if (opt.web || opt.webworker) {
      const fh = await fsp.open(opt.output, "w")
      let i = 0
      const lines = jscode.split(/\r\n|\r|\n/)
      while (i < lines.length) {
        let t = lines[i]
        if (/^import/.test(t)) {
          t = t.replace(/\.mjs/, '.js')
        } else
        if (/self\.clearFuncList\.map/.test(t)) {
          t = t.replace(/self\./, '// self.')
        }
        t = t + "\n"
        await fh.write(t, null, "utf-8")
        i++
      }
      await fh.close()
    } else {
      fs.writeFileSync(opt.output, jscode, 'utf-8')
    }

    // 実行に必要なファイル・モジュール一式をコピー
    const outRuntime = path.join(path.dirname(opt.output), 'nako3runtime')
    if (!fs.existsSync(outRuntime)) { fs.mkdirSync(outRuntime) }

    // 実行に必要なファイルのコピーを行う
    const targetKeys:TargetKey[] = ['commonFiles', opt.webworker ? 'webworkerFiles' : opt.web ? 'webFiles' : 'nodeFiles']
    for (const filesInfo of standalone_files) {
      for (const targetKey of targetKeys) {
        const item = filesInfo[targetKey]
        if (item !== null) {
          for (const mod of item) {
            const destMod = opt.web ? mod.replace(/\.mjs/, '.js') : mod
            if (filesInfo.fromDir !== 'release' && ( opt.web || opt.webworker)) {
              const data = await fsp.readFile(path.join(srcDir[filesInfo.fromDir], mod), { encoding: "utf-8" })
              const fh = await fsp.open(path.join(outRuntime, destMod), "w")
              let i = 0
              const lines = data.split(/\r\n|\r|\n/)
              while (i < lines.length) {
                let t = lines[i]
                if (/^import/.test(t)) {
                  t = t.replace(/\.mjs/, '.js')
                }
                t = t + "\n"
                await fh.write(t, null, "utf-8")
                i++
              }
              await fh.close()
            } else {
              fs.copyFileSync(path.join(srcDir[filesInfo.fromDir], mod), path.join(outRuntime, destMod))
            }
          }
        }
      }
    }

    if (opt.plugin.length > 0) {
      for (const plugin of opt.plugin) {
        if (plugin != null && plugin !== '') {
          const pluginPath = Nako3Build.findJSPluginFile(plugin, this.filename, __dirname, [], opt.web || opt.webworker)
          if (pluginPath !== '') {
            const mod = plugin
            const destMod = opt.web ? plugin.replace(/\.mjs/, '.js') : mod
            if (!/\\release$/.test(path.dirname(pluginPath)) && ( opt.web || opt.webworker)) {
              const data = await fsp.readFile(pluginPath, { encoding: "utf-8" })
              const fh = await fsp.open(path.join(outRuntime, destMod), "w")
              let i = 0
              const lines = data.split(/\r\n|\r|\n/)
              while (i < lines.length) {
                let t = lines[i]
                if (/^import/.test(t)) {
                  t = t.replace(/\.mjs/, '.js')
                }
                t = t + "\n"
                await fh.write(t, null, "utf-8")
                i++
              }
              await fh.close()
            } else {
              fs.copyFileSync(plugin, path.join(outRuntime, destMod))
            }
          }
        }
      }
    }

    // 実行に必要なモジュールのコピーを行う
    if (standalone_modules !== null) {
      for (const targetKey of targetKeys) {
        const modlist = standalone_modules[targetKey]
        if (modlist !== null) {
          // or 以下のコピーだと依存ファイルがコピーされない package.jsonを見てコピーする必要がある
          const orgModule = path.join(__dirname, '..', 'node_modules')
          const dirNodeModules = path.join(path.dirname(opt.output), 'node_modules')
          const copied: { [key: string]: boolean } = {}
          // 再帰的に必要なモジュールをコピーする
          const copyModule = (mod: string) => {
            if (copied[mod]) { return }
            copied[mod] = true
            // ライブラリ自身をコピー
            fse.copySync(path.join(orgModule, mod), path.join(dirNodeModules, mod))
            // 依存ライブラリをコピー
            const packageFile = path.join(orgModule, mod, 'package.json')
            const jsonStr = fs.readFileSync(packageFile, 'utf-8')
            const jsonData = JSON.parse(jsonStr)
            // サブモジュールをコピー
            for (const smod in jsonData.dependencies) {
              copyModule(smod)
            }
          }
          for (const mod of modlist) {
            copyModule(mod)
          }
        }
      }
    }
  }

  async addGenerator (generatorFile: string) {
    const filepath = Nako3Build.findJSPluginFile (generatorFile, this.filename, __dirname, [], true)
    if (filepath !== '') {
      const module = await import(filepath)
      const gen = module.default
      gen.selfRegister(this)
    } else {
      console.error(`指定されたコードジェネレータがみつかりませんでした:${generatorFile}`)
      process.exit(1)
    }
  }

  /**
   * JSONを出力
   */
  outputJSON (ast: any, level: number): string {
    const makeIndent = (level: number) => {
      let s = ''
      for (let i = 0; i < level; i++) { s += '  ' }
      return s
    }
    const trim = (s: string) => { return s.replace(/(^\s+|\s+$)/g, '') }

    if (typeof (ast) === 'string') {
      return makeIndent(level) + '"' + ast + '"'
    }
    if (typeof (ast) === 'number') {
      return makeIndent(level) + ast
    }
    if (ast instanceof Array) {
      const s = makeIndent(level) + '[\n'
      const sa: string[] = []
      ast.forEach((a: Ast) => {
        sa.push(this.outputJSON(a, level + 1))
      })
      return s + sa.join(',\n') + '\n' + makeIndent(level) + ']'
    }
    if (ast instanceof Object) {
      const s = makeIndent(level) + '{\n'
      const sa = []
      for (const key in ast) {
        const sv = trim(this.outputJSON((ast as any)[key], level + 1))
        const so = makeIndent(level + 1) + '"' + key + '": ' + sv
        sa.push(so)
      }
      return s + sa.join(',\n') + '\n' + makeIndent(level) + '}'
    }
    return makeIndent(level) + ast
  }

  /**
   * ASTを出力
   */
  outputAST (opt: any, src: string) {
    const ast = this.parse(src, opt.mainfile)
    console.log(this.outputJSON(ast, 0))
  }

  // マニュアルを表示する
  cnakoMan (command: string) {
    try {
      const pathCommands = path.join(__dirname, '../node_modules/nadesiko3/release/command_cnako3.json')
      const commands = JSON.parse(fs.readFileSync(pathCommands, 'utf-8'))
      const data = commands[command]
      for (const key in data) {
        console.log(`${key}: ${data[key]}`)
      }
    } catch (e: any) {
      if (e.code === 'MODULE_NOT_FOUND') {
        console.log('コマンド一覧がないため、マニュアルを表示できません。以下のコマンドでコマンド一覧を生成してください。\n$ npm run build')
      } else {
        throw e
      }
    }
  }

  // 対応機器/Webブラウザを表示する
  cnakoBrowsers () {
    const fileMD = path.resolve(__dirname, '../doc', 'browsers.md')
    console.log(fs.readFileSync(fileMD, 'utf-8'))
  }

  // (js|nako3) loader
  getLoaderTools () {
    /** @type {string[]} */
    const log: string[] = []
    const tools: LoaderTool = {
      resolvePath: (name: string, token: any, fromFile: string): {filePath: string, type: string} => {
        // 最初に拡張子があるかどうかをチェック
        // JSプラグインか？
        if (/\.(js|mjs)(\.txt)?$/.test(name)) {
          const jspath = Nako3Build.findJSPluginFile(name, fromFile, __dirname, log, false)
          if (jspath === '') {
            throw new NakoImportError(`JSプラグイン『${name}』が見つかりません。コマンドラインで『npm install ${name}』を実行してみてください。以下のパスを検索しました。\n${log.join('\n')}`, token.file, token.line)
          }
          return { filePath: jspath, type: 'js' }
        }
        // なでしこプラグインか？
        if (/\.(nako3|nako)(\.txt)?$/.test(name)) {
          // ファイルかHTTPか
          if (name.startsWith('http://') || name.startsWith('https://')) {
            return { filePath: name, type: 'nako3' }
          }
          if (path.isAbsolute(name)) {
            return { filePath: path.resolve(name), type: 'nako3' }
          } else {
            // filename が undefined のとき token.file が undefined になる。
            if (token.file === undefined) { throw new Error('ファイル名を指定してください。') }
            const dir = path.dirname(fromFile)
            return { filePath: path.resolve(path.join(dir, name)), type: 'nako3' }
          }
        }
        // 拡張子がない、あるいは、(.js|.mjs|.nako3|.nako)以外はJSモジュールと見なす
        const jspath2 = Nako3Build.findJSPluginFile(name, fromFile, __dirname, log, false)
        if (jspath2 === '') {
          throw new NakoImportError(`JSプラグイン『${name}』が見つかりません。コマンドラインで『npm install ${name}』を実行してみてください。以下のパスを検索しました。\n${log.join('\n')}`, token.file, token.line)
        }
        return { filePath: jspath2, type: 'js' }
      },
      readNako3: (name, token) => {
        const loader:any = { task: null }
        // ファイルかHTTPか
        if (name.startsWith('http://') || name.startsWith('https://')) {
          // Webのファイルを非同期で読み込む
          loader.task = (async () => {
            const res = await fetch(name)
            if (!res.ok) {
              throw new NakoImportError(`『${name}』からのダウンロードに失敗しました: ${res.status} ${res.statusText}`, token.file, token.line)
            }
            return await res.text()
          })()
        } else {
          // ファイルを非同期で読み込む
          // ファイルチェックだけ先に実行
          if (!fs.existsSync(name)) {
            throw new NakoImportError(`ファイル ${name} が存在しません。`, token.file, token.line)
          }
          loader.task = (new Promise((resolve, reject) => {
            fs.readFile(name, { encoding: 'utf-8' }, (err, data) => {
              if (err) { return reject(err) }
              resolve(data)
            })
          }))
        }
        // 非同期で読み込む
        return loader
      },
      readJs: (filePath, token) => {
        const loader: any = { task: null }
        if (process.platform === 'win32') {
          if (filePath.substring(1, 3) === ':\\') {
            filePath = 'file://' + filePath
          }
        }
        // + プラグインの読み込みタスクを生成する
        // | プラグインがWeb(https?://...)に配置されている場合
        if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
          // 動的 import が http 未対応のため、一度、Webのファイルを非同期で読み込んで/tmpに保存してから動的importを行う
          loader.task = (
            new Promise((resolve, reject) => {
              // 一時フォルダを得る
              const osTmpDir = (process.platform === 'win32') ? process.env.TEMP : '/tmp'
              const osTmpDir2 = (osTmpDir) || path.join('./tmp')
              const tmpDir = path.join(osTmpDir2, 'com.nadesi.v3.cnako')
              const tmpFile = path.join(tmpDir, filePath.replace(/[^a-zA-Z0-9_.]/g, '_'))
              if (!fs.existsSync(tmpDir)) { fs.mkdirSync(tmpDir, { recursive: true }) }
              // WEBからダウンロード
              fetch(filePath)
                .then((res: any) => {
                  return res.text()
                })
                .then((txt: string) => {
                  // ダウンロード
                  if (txt.indexOf('Failed to fetch') >= 0) {
                    const errFetch = new NakoImportError(`URL『${filePath}』のライブラリが存在しないか、指定のバージョンが間違っています。`, token.file, token.line)
                    reject(errFetch)
                  }
                  // 一時ファイルに保存
                  try {
                    fs.writeFileSync(tmpFile, txt, 'utf-8')
                  } catch (err) {
                    const err2 = new NakoImportError(`URL『${filePath}』からダウンロードしたJSファイルがキャッシュに書き込めません。${err}`, token.file, token.line)
                    reject(err2)
                  }
                })
                .then(() => {
                // 一時ファイルから読み込む
                  import(tmpFile).then((mod) => {
                  // プラグインは export default で宣言
                    const obj = Object.assign({}, mod)
                    resolve(() => {
                      return obj.default
                    })
                  }).catch((err) => {
                    const errS = '' + err
                    if (errS.indexOf('SyntaxError:') >= 0) {
                      const err2 = new NakoImportError(`URL『${filePath}』からダウンロードしたJSファイルに文法エラーがあります。${err}`, token.file, token.line)
                      reject(err2)
                    } else {
                      const err3 = new NakoImportError(`URL『${filePath}』からダウンロードしたはずのJSファイル読み込めません。${err}`, token.file, token.line)
                      reject(err3)
                    }
                  })
                })
                .catch((err: any) => {
                  const err2 = new NakoImportError(`URL『${filePath}』からJSファイルが読み込めません。${err}`, token.file, token.line)
                  reject(err2)
                })
            })
          )
          return loader
        }
        // | プラグインがファイル上に配置されている場合
        loader.task = (
          new Promise((resolve, reject) => {
            import(filePath).then((mod) => {
              // プラグインは export default で宣言
              const obj = Object.assign({}, mod)
              resolve(() => { return obj.default })
            }).catch((err) => {
              const err2 = new NakoImportError(`ファイル『${filePath}』が読み込めません。${err}`, token.file, token.line)
              reject(err2)
            })
          })
        )
        return loader
      }
    }
    return tools
  }

  /** 『!「xxx」を取込』の処理 */
  async loadDependencies (code: string, filename: string, preCode: string) {
    const tools = this.getLoaderTools()
    await super._loadDependencies(code, filename, preCode, tools)
  }

  /**
   * プラグインファイルの検索を行う
   * @param pname プラグインの名前
   * @param filename 取り込み元ファイル名
   * @param srcDir このファイルが存在するディレクトリ
   * @param log
   * @param serchRease releaseフォルダを検索に含むかどうか(trueなら含む)
   * @return フルパス、失敗した時は、''を返す
   */
  static findJSPluginFile (pname: string, filename: string, srcDir: string, log: string[] = [], isWeb: boolean = false): string {
    log.length = 0
    const cachePath: {[key: string]: boolean} = {}
    /** キャッシュ付きでファイルがあるか検索 */
    const exists = (f: string): boolean => {
      // 同じパスを何度も検索することがないように
      if (cachePath[f]) { return cachePath[f] }
      try {
        // ファイルがないと例外が出る
        const stat = fs.statSync(f)
        const b = !!(stat && stat.isFile())
        cachePath[f] = b
        return b
      } catch (err: any) {
        return false
      }
    }
    /** 普通にファイルをチェック */
    const fCheck = (pathTest: string, desc: string): boolean => {
      // 素直に指定されたパスをチェック
      const bExists = exists(pathTest)
      log.push(`- (${desc}) ${pathTest}, ${bExists}`)
      return bExists
    }
    /** 通常 + package.json のパスを調べる */
    const fCheckEx = (pathTest: string, desc: string): string => {
      // 直接JSファイルが指定された？
      if (/\.(js|mjs)$/.test(pathTest)) {
        if (fCheck(pathTest, desc)) { return pathTest }
      }
      // 指定パスのpackage.jsonを調べる
      const json = path.join(pathTest, 'package.json')
      if (fCheck(json, desc + '/package.json')) {
        // package.jsonを見つけたので、メインファイルを調べて取り込む (CommonJSモジュール対策)
        const jsonText = fs.readFileSync(json, 'utf-8')
        const obj = JSON.parse(jsonText)
        if (!obj.main) { return '' }
        const mainFile = path.resolve(path.join(pathTest, obj.main))
        return mainFile
      }
      return ''
    }

    // URL指定か?
    if (pname.substring(0, 8) === 'https://') {
      return pname
    }
    // 各パスを検索していく
    const p1 = pname.substring(0, 1)
    // フルパス指定か?
    if (p1 === '/' || pname.substring(1, 3).toLowerCase() === ':\\' || pname.substring(0, 6) === 'file:/') {
      const fileFullpath = fCheckEx(pname, 'フルパス')
      if (fileFullpath) { return fileFullpath }
      return '' // フルパスの場合別のフォルダは調べない
    }
    // 相対パスか?
    if (p1 === '.' || pname.indexOf('/') >= 0) {
      // 相対パス指定なので、なでしこのプログラムからの相対指定を調べる
      const pathRelative = path.join(path.resolve(path.dirname(filename)), pname)
      const fileRelative = fCheckEx(pathRelative, '相対パス')
      if (fileRelative) { return fileRelative }
      return '' // 相対パスの場合も別のフォルダは調べない
    }
    // plugin_xxx.mjs のようにファイル名のみが指定された場合のみ、いくつかのパスを調べる
    // 母艦パス(元ファイルと同じフォルダ)か?
    const testScriptPath = path.join(path.resolve(path.dirname(filename)), pname)
    const fileScript = fCheckEx(testScriptPath, '母艦パス')
    if (fileScript) { return fileScript }

    // ランタイムパス/src/<plugin>
    if (pname.match(/^\.[cm]?js/)) {
      // cnako3mod.mjs は ランタイム/src に配置されていることが前提
      const pathRoot = path.resolve(__dirname, '..')
      if (isWeb) {
        // ランタイム/release/<plugin>
        const pathRelease = path.join(pathRoot, 'release', pname)
        const fileRelease = fCheck(pathRelease, 'CNAKO3パス')
        if (fileRelease) { return pathRelease }
      }
      // ランタイム/src/<plugin>
      const pathRuntimeSrc = path.join(pathRoot, 'src', pname)
      const fileRuntimeSrc = fCheck(pathRuntimeSrc, 'CNAKO3パス')
      if (fileRuntimeSrc) { return pathRuntimeSrc }
    }

    // 環境変数をチェック
    // 環境変数 NAKO_LIB か?
    if (process.env.NAKO_LIB) {
      const NAKO_LIB = path.join(path.resolve(process.env.NAKO_LIB), pname)
      const fileLib = fCheckEx(NAKO_LIB, 'NAKO_LIB')
      if (fileLib) { return fileLib }
    }

    // ランタイムパス/node_modules/<plugin>
    const pathRuntime = path.join(path.dirname(path.resolve(__dirname)))
    const pathRuntimePname = path.join(pathRuntime, 'node_modules', pname)
    const fileRuntime = fCheckEx(pathRuntimePname, 'runtime')
    if (fileRuntime) { return fileRuntime }

    // ランタイムと同じ配置 | ランタイムパス/../<plugin>
    const runtimeLib = path.join(pathRuntime, '..', pname)
    const fileLib = fCheckEx(runtimeLib, 'runtimeLib')
    if (fileLib) { return fileLib }

    if (pname.match(/^\.[cm]?js/)) {
      // nadesiko3 | ランタイムパス/node_modules/nadesiko3/src/<plugin>
      const pathRuntimeSrc = path.join(pathRuntime, 'node_modules', 'nadesiko3', 'src', pname)
      const fileRuntimeSrc = fCheckEx(pathRuntimeSrc, 'nadesiko3')
      if (fileRuntimeSrc) { return fileRuntimeSrc }
      if (isWeb) {
        const pathRuntimeRelease = path.join(pathRuntime, 'node_modules', 'nadesiko3', 'release', pname)
        const fileRuntimeRelease = fCheckEx(pathRuntimeRelease, 'nadesiko3')
        if (fileRuntimeRelease) { return fileRuntimeRelease }
      }

      // nadesiko3/core | ランタイムパス/node_modules/nadesiko3/src/<plugin>
      const pathRuntimeInCoreSrc = path.join(pathRuntime, 'node_modules', 'nadesiko3', 'core', 'src', pname)
      const fileRuntimeInCoreSrc = fCheckEx(pathRuntimeInCoreSrc, 'nadesiko3core')
      if (fileRuntimeInCoreSrc) { return fileRuntimeInCoreSrc }

      // nadesiko3core | ランタイムパス/node_modules/nadesiko3core/src/<plugin>
      const pathRuntimeCoreSrc = path.join(pathRuntime, 'node_modules', 'nadesiko3core', 'src', pname)
      const fileRuntimeCoreSrc = fCheckEx(pathRuntimeCoreSrc, 'nadesiko3core')
      if (fileRuntimeCoreSrc) { return fileRuntimeCoreSrc }
    }

    // 環境変数 NAKO_HOMEか?
    if (process.env.NAKO_HOME) {
      const NAKO_HOME = path.join(path.resolve(process.env.NAKO_HOME), 'node_modules', pname)
      const fileHome = fCheckEx(NAKO_HOME, 'NAKO_HOME')
      if (fileHome) { return fileHome }
      if (isWeb) {
        // NAKO_HOME/release ?
        const pathNakoHomeRelease = path.join(NAKO_HOME, 'release', pname)
        const fileNakoHomeRelease = fCheckEx(pathNakoHomeRelease, 'NAKO_HOME/release')
        if (fileNakoHomeRelease) { return fileNakoHomeRelease }
      }
      // NAKO_HOME/src ?
      const pathNakoHomeSrc = path.join(NAKO_HOME, 'src', pname)
      const fileNakoHomeSrc = fCheckEx(pathNakoHomeSrc, 'NAKO_HOME/src')
      if (fileNakoHomeSrc) { return fileNakoHomeSrc }
    }
    // 環境変数 NODE_PATH (global) 以下にあるか？
    if (process.env.NODE_PATH) {
      const pathNode = path.join(path.resolve(process.env.NODE_PATH), pname)
      const fileNode = fCheckEx(pathNode, 'NODE_PATH')
      if (fileNode) { return fileNode }
    }
    // Nodeのパス検索には任せない(importで必ず失敗するので)
    return ''
  }
}
