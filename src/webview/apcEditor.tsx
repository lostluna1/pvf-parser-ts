import * as React from 'react';
// 声明全局 VS Code webview API 获取函数（运行时由 VS Code 注入）
declare function acquireVsCodeApi(): any;
import { createRoot } from 'react-dom/client';
import {
    FluentProvider,
    Button,
    makeStyles,
    tokens
} from '@fluentui/react-components';
import { getAppTheme } from './theme';
import { parseAic } from './apcPage/apc_parser';

// === 全局 VSCode API ===
// 复用全局缓存的 vscodeApi，避免重复 acquire
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
const vscode = (window as any).vscodeApi || (typeof acquireVsCodeApi === 'function' && !(window as any).__vscodeApiAcquired ? (function () {
    try { const api = acquireVsCodeApi(); (window as any).vscodeApi = api; (window as any).__vscodeApiAcquired = true; return api; } catch { return null; }
})() : null);

// 与 aniPreview 对齐的一组 UI 颜色（简化版）
const UI_COLORS = {
    panelGradient: 'linear-gradient(180deg, rgba(30,30,30,0.92), rgba(30,30,30,0.88) 60%, rgba(30,30,30,0.75))',
    sectionBgToken: tokens.colorNeutralBackground1,
    sectionBorder: tokens.colorNeutralStroke1,
    valueBadgeBgToken: tokens.colorNeutralBackground3,
    miniBarGradient: 'linear-gradient(180deg, rgba(0,0,0,0.78), rgba(0,0,0,0))'
};

interface InitData { path: string; text: string; version?: string }

const useStyles = makeStyles({
    root: {
        position: 'relative',
        display: 'flex', flexDirection: 'column', height: '100%', width: '100%',
        background: 'var(--vscode-editor-background)',
        fontFamily: '"Microsoft YaHei","微软雅黑","Segoe UI",Arial'
    },
    topPanelShell: {
        position: 'absolute', top: 0, left: 0, width: '100%', zIndex: 10, pointerEvents: 'none'
    },
    topPanelInner: {
        pointerEvents: 'auto', display: 'flex', flexDirection: 'column', rowGap: '12px',
        padding: '14px 18px 18px 18px', background: UI_COLORS.panelGradient,
        backdropFilter: 'blur(6px)', borderBottom: `1px solid ${UI_COLORS.sectionBorder}`,
        boxShadow: '0 4px 12px rgba(0,0,0,0.45)'
    },
    panelGroups: { display: 'flex', flexDirection: 'column', width: '100%', rowGap: '14px' },
    section: {
        display: 'flex', flexDirection: 'column', rowGap: '8px',
        background: UI_COLORS.sectionBgToken, border: `1px solid ${UI_COLORS.sectionBorder}`,
        borderRadius: '4px', padding: '8px 10px'
    },
    sectionHeader: { fontSize: '12px', fontWeight: 600, letterSpacing: '0.5px', opacity: .85, display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
    inlineRow: { display: 'flex', alignItems: 'center', columnGap: '8px', flexWrap: 'wrap' },
    miniBar: { position: 'absolute', top: 0, left: 0, width: '100%', display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '6px 12px', background: UI_COLORS.miniBarGradient, fontSize: '12px', zIndex: 5, pointerEvents: 'none' },
    miniBarContent: { display: 'flex', alignItems: 'center', gap: '8px', pointerEvents: 'auto', flexWrap: 'wrap' },
    editorWrap: { position: 'absolute', inset: 0, top: 0, display: 'flex', flexDirection: 'column', paddingTop: '48px' },
    textarea: { flex: 1, resize: 'none', fontFamily: 'Consolas, monospace', fontSize: '12px' },
    statsLine: { fontSize: '11px', opacity: .65, display: 'flex', gap: '12px', flexWrap: 'wrap' }
});

const App: React.FC<{ init: InitData }> = ({ init }) => {
    const styles = useStyles();
    const theme = React.useMemo(() => getAppTheme('dark'), []); // 根据背景始终暗色（也可做切换）

    // 消息处理
    React.useEffect(() => {
        const handler = (e: MessageEvent) => {
        };
        window.addEventListener('message', handler); return () => window.removeEventListener('message', handler);
    }, []);


    async function aicParseTest(): Promise<void> {
        try {
            const res = await parseAic(init.text, init.path);
            console.log('[AIC parse result]', res);
        } catch (e) {
            console.error('解析失败', e);
        }
    }

    return (
        <FluentProvider theme={theme} className={styles.root}>

            <Button appearance='primary' onClick={() => aicParseTest()}>测试</Button>
        </FluentProvider>
    );
};

function main() {
    const root = document.getElementById('root'); if (!root) return;
    window.addEventListener('error', e => console.error('[APCEditor Error]', e.error || e.message));
    window.addEventListener('unhandledrejection', (e: any) => console.error('[APCEditor Unhandled]', e.reason));
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const init: InitData = (window as any).__INIT;
    createRoot(root).render(<App init={init} />);
}
main();
