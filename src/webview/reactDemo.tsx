import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Button, Input, FluentProvider, webLightTheme, makeStyles, TabList, Tab, tokens } from '@fluentui/react-components';

// VS Code API (在 webview 中由宿主注入)
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;

const useStyles = makeStyles({
  app: { padding: '12px', fontSize: '12px', height: '100%', width: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', overflow: 'auto' },
  row: { marginTop: '12px', display: 'flex', gap: '8px', alignItems: 'center' },
  counter: { color: tokens.colorBrandForeground1 }
});

interface InitData {
  version?: string;
  activeFile?: string;
  npkRoot?: string;
  time?: string;
}

const customTheme = {
  ...webLightTheme,
  fontFamilyBase: '"Microsoft YaHei","微软雅黑","Segoe UI",Arial,sans-serif'
};

const App: React.FC = () => {
  const styles = useStyles();
  const [count, setCount] = React.useState(0);
  const [text, setText] = React.useState('');
  const [init, setInit] = React.useState<InitData | null>(null);
  const [pongTs, setPongTs] = React.useState<number | null>(null);

  React.useEffect(() => {
    const handler = (e: MessageEvent) => {
      const msg = e.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'init') {
        setInit(msg.data || {});
      } else if (msg.type === 'pong') {
        setPongTs(msg.ts);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const sendPing = () => {
    vscode?.postMessage({ type: 'ping', payload: Date.now() });
  };
  return (
    <FluentProvider theme={customTheme} className={styles.app}>
      <h3 style={{marginTop:0}}>React + Fluent UI Demo</h3>
      <p>这是使用 TSX 构建并通过 esbuild 打包后的 Webview 示例。</p>
      <div style={{fontSize:12,opacity:.8}}>
        {init ? (
          <>
            <div>扩展版本: {init.version}</div>
            <div>当前文件: {init.activeFile || '(无)'}</div>
            <div>NPK Root: {init.npkRoot || '(未设置)'}</div>
            <div>激活时间: {init.time}</div>
          </>
        ) : <span>等待扩展发送初始化数据…</span>}
      </div>
      <div className={styles.row}>
  <Button appearance="primary" onClick={() => setCount((c: number) => c + 1)}>点击 +1</Button>
        <span className={styles.counter}>计数: {count}</span>
      </div>
      <div className={styles.row}>
  <Input placeholder="输入文本" value={text} onChange={(_e, data) => setText(data.value)} />
        <span>长度: {text.length}</span>
      </div>
      <div className={styles.row}>
        <TabList defaultSelectedValue="tab1">
          <Tab value="tab1">Tab1</Tab>
          <Tab value="tab2">Tab2</Tab>
        </TabList>
      </div>
      <div className={styles.row}>
        <Button onClick={sendPing}>发送 Ping</Button>
        <span>{pongTs ? '收到 PONG: ' + new Date(pongTs).toLocaleTimeString() : '尚未收到 PONG'}</span>
      </div>
    </FluentProvider>
  );
};

function main() {
  const el = document.getElementById('root');
  if (!el) return;
  createRoot(el).render(<App />);
}

main();
