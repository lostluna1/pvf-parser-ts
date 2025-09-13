import * as React from 'react';
import { createRoot } from 'react-dom/client';
import {
    FluentProvider,
    Button,
    makeStyles,
    tokens,
    Select,
    Field,
    SearchBox,
    Spinner,
    Dialog,
    DialogSurface,
    DialogBody,
    DialogTitle,
    DialogContent,
    DialogActions,
    Input
} from '@fluentui/react-components';
import { Dismiss24Regular } from '@fluentui/react-icons';
import { TabList, Tab } from '@fluentui/react-components';
import { getAppTheme } from './theme';
import { parseAic } from './apcPage/apc_parser';
import { AicParseResult } from './apcPage/apc_types';


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
        fontFamily: '"Microsoft YaHei","微软雅黑","Segoe UI",Arial',
        overflow: 'hidden' // 由内部 tabContent 负责滚动
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
    statsLine: { fontSize: '11px', opacity: .65, display: 'flex', gap: '12px', flexWrap: 'wrap' },
    skillsWrap: { display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '4px 12px 16px 12px' }, // legacy (unused for quick slots now)
    quickSlots: { display: 'flex', gap: '10px', padding: '8px 12px 16px 12px', flexWrap: 'wrap' },
    quickSlot: { position: 'relative', width: '50px', height: '50px', borderRadius: '6px', background: '#181818', overflow: 'hidden', border: '1px solid #333', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },
    quickSlotEmpty: { border: '1px dashed #444', background: '#141414' },
    quickPlus: { fontSize: '28px', fontWeight: 300, color: '#666', userSelect: 'none' },
    removeMask: { position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', letterSpacing: '1px', fontWeight: 600 },
    skillItem: { position: 'relative', width: '50px', height: '50px', borderRadius: '6px', background: '#222', overflow: 'hidden', border: '1px solid #333', display: 'flex', alignItems: 'center', justifyContent: 'center' },
    skillImg: { maxWidth: '100%', maxHeight: '100%', imageRendering: 'pixelated' },
    levelBadge: { position: 'absolute', top: 0, right: 0, background: 'rgba(0,0,0,0.65)', color: '#fff', fontSize: '10px', lineHeight: '14px', padding: '0 4px', borderBottomLeftRadius: '4px', fontWeight: 600, pointerEvents: 'none' },
    searchRow: { display: 'flex', alignItems: 'center', gap: '12px', padding: '0 0 8px 0' },
    suggPanel: { position: 'relative', maxHeight: '300px', overflowY: 'auto', background: '#1f1f1f', border: '1px solid #333', borderRadius: '6px', padding: '6px', display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '8px' },
    suggItem: {
        display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 6px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', lineHeight: '16px', background: 'transparent', border: '1px solid transparent'
    },
    suggItemHoverState: { background: '#2a2a2a' },
    suggIconBox: { width: '28px', height: '28px', borderRadius: '4px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#222', border: '1px solid #333' },
    tabHeaderWrap: { padding: '0 12px' },
    learnedGrid: { display: 'flex', flexWrap: 'wrap', gap: '10px', padding: '0 12px 24px 12px' },
    learnedItem: { width: '62px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#ccc' },
    learnedIconBox: { position: 'relative', width: '48px', height: '48px', borderRadius: '6px', background: '#202020', border: '1px solid #333', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    learnedLevel: { position: 'absolute', bottom: 0, right: 0, background: 'rgba(0,0,0,0.55)', fontSize: '10px', padding: '0 4px', lineHeight: '14px', borderTopLeftRadius: '4px', color: '#fff', fontWeight: 600 },
    learnedRemoveMask: { position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '12px', fontWeight: 600, letterSpacing: '1px' }
    ,equipmentGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '12px', padding: '12px' }
    ,equipmentCard: { position: 'relative', display: 'flex', flexDirection: 'column', gap: '6px', padding: '8px 8px 10px 8px', background: '#1e1e1e', border: '1px solid #333', borderRadius: '6px', fontSize: '11px', color: '#ccc', overflow: 'hidden' }
    ,equipmentIconBox: { width: '56px', height: '56px', borderRadius: '6px', background: '#222', border: '1px solid #333', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', alignSelf: 'center' }
    ,equipmentIcon: { maxWidth: '100%', maxHeight: '100%', imageRendering: 'pixelated' }
    ,equipmentName: { fontWeight: 600, fontSize: '12px', lineHeight: '16px', textAlign: 'center', wordBreak: 'break-all' }
    ,equipmentBadges: { display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '4px' }
    ,equipmentBadge: { background: '#2a2a2a', border: '1px solid #444', padding: '2px 4px', borderRadius: '4px', fontSize: '10px', lineHeight: '12px' }
    ,equipmentId: { position: 'absolute', top: '4px', right: '6px', fontSize: '10px', opacity: .45 }
    ,tabContent: { flex: 1, overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column' }
});

interface SkillInfo { id: number; skillName?: string; iconBase64?: string; level?: number }

const App: React.FC<{ init: InitData }> = ({ init }) => {
    const styles = useStyles();
    const theme = React.useMemo(() => getAppTheme('dark'), []); // 根据背景始终暗色（也可做切换）

    const [parseResult, setParseResult] = React.useState<AicParseResult | null>(null);
    const [growIndex, setGrowIndex] = React.useState<number | null>(null);
    const [loading, setLoading] = React.useState<boolean>(false);
    const quickSkillsParsed: SkillInfo[] = parseResult?.quickSkills || [];
    const allSkills: SkillInfo[] = (parseResult?.jobAllSkills as SkillInfo[]) || [];
    const [dialogOpen, setDialogOpen] = React.useState(false);
    const [query, setQuery] = React.useState('');
    const filteredAll: SkillInfo[] = React.useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return allSkills;
        return allSkills.filter(s => (s.skillName || '').toLowerCase().includes(q));
    }, [allSkills, query]);
    const [quickSkills, setQuickSkills] = React.useState<SkillInfo[]>([]);
    const [selectedLevel, setSelectedLevel] = React.useState<number>(1);
    const [hoverSlot, setHoverSlot] = React.useState<number | null>(null);
    const [learnedAll, setLearnedAll] = React.useState<SkillInfo[]>([]); // 所有已掌握（不含已放入快捷栏的初始过滤）
    const [dialogMode, setDialogMode] = React.useState<'quick' | 'learned'>('quick');
    const [hoverLearnedId, setHoverLearnedId] = React.useState<number | null>(null);
    React.useEffect(() => {
        if (parseResult?.quickSkills) {
            const initialQuick = parseResult.quickSkills.slice(0, 6);
            setQuickSkills(initialQuick);
            // 初始化 learnedAll: parseResult.skills - initialQuick ids
            const quickIds = new Set(initialQuick.map(s => s.id));
            setLearnedAll((parseResult.skills || []).filter(s => !quickIds.has(s.id)));
        }
    }, [parseResult?.quickSkills, parseResult?.skills]);
    const MAX_SLOTS = 6;
    function addQuickSkill(skill: SkillInfo) {
        const lvl = isFinite(selectedLevel) ? Math.max(1, Math.min(100, selectedLevel)) : 1;
        setQuickSkills(prev => {
            if (prev.find(s => s.id === skill.id)) return prev; // 已存在不重复添加
            if (prev.length >= MAX_SLOTS) return prev; // 满了
            return [...prev, { ...skill, level: lvl }];
        });
        setDialogOpen(false); setQuery('');
    }
    function removeQuickAt(idx: number) {
        setQuickSkills(prev => prev.filter((_, i) => i !== idx));
    }
    function adjustQuickLevel(idx: number, delta: number) {
        setQuickSkills(prev => prev.map((s, i) => {
            if (i !== idx) return s;
            const base = Number(s.level);
            const current = isFinite(base) && base > 0 ? base : 1;
            const next = Math.max(1, Math.min(100, current + delta));
            return { ...s, level: next };
        }));
    }
    function addLearnedSkill(skill: SkillInfo) {
        setLearnedAll(prev => {
            if (prev.find(s => s.id === skill.id)) return prev; // 已存在
            if (quickSkills.find(s => s.id === skill.id)) return prev; // 在快捷栏
            const lvl = (skill.level && skill.level > 0) ? skill.level : selectedLevel;
            return [...prev, { ...skill, level: lvl }];
        });
        setDialogOpen(false); setQuery('');
    }
    function removeLearnedSkill(id: number) {
        setLearnedAll(prev => prev.filter(s => s.id !== id));
    }
    function adjustLearnedLevel(id: number, delta: number) {
        setLearnedAll(prev => prev.map(s => {
            if (s.id !== id) return s;
            const base = Number(s.level);
            const current = isFinite(base) && base > 0 ? base : 1;
            const next = Math.max(1, Math.min(100, current + delta));
            return { ...s, level: next };
        }));
    }
    const displayLearned = React.useMemo(() => {
        const quickIds = new Set(quickSkills.map(s => s.id));
        return learnedAll.filter(s => !quickIds.has(s.id));
    }, [learnedAll, quickSkills]);

    const [activeTab, setActiveTab] = React.useState<string>('skills');

    // 注入一次全局样式，去掉输入焦点的黄色 outline（VS Code webview 默认 focusBorder）
    React.useEffect(() => {
        const styleId = 'apc-no-focus-outline-style';
        if (!document.getElementById(styleId)) {
            const st = document.createElement('style');
            st.id = styleId;
            st.textContent = `
            /* 全局移除焦点黄色高亮（在此 webview 内） */
            #root :focus,#root :focus-visible,#root [data-focus-visible-added]{
                outline:none !important;
                box-shadow:none !important;
            }
            /* 兼容单独类名 */
            .apc-no-focus-outline input:focus,
            .apc-no-focus-outline input:focus-visible,
            .apc-no-focus-outline [data-focus-visible-added]{
                outline:none !important;box-shadow:none !important;
            }
            .apc-no-focus-outline input{outline:none !important;}
            /* Fluent UI 输入框 wrapper 可能有伪元素或自带 box-shadow，用下列选择器覆盖 */
            .fui-Input:focus-within,.fui-SearchBox:focus-within{outline:none !important; box-shadow:none !important;}
            .fui-Input input,.fui-SearchBox input{outline:none !important; box-shadow:none !important;}
            `;
            document.head.appendChild(st);
        }
    }, []);

    // 消息处理
    React.useEffect(() => {
        const handler = (_e: MessageEvent) => {
        };
        window.addEventListener('message', handler); return () => window.removeEventListener('message', handler);
    }, []);


    // 首次自动解析
    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const res: AicParseResult = await parseAic(init.text) as any;
                if (cancelled) return;
                setParseResult(res);
                const idx = res.allGrowTypeNames?.indexOf(res.growTypeName ?? '');
                setGrowIndex(idx != null && idx >= 0 ? idx : null);
            } catch (e) {
                if (!cancelled) console.error('解析失败', e);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [init.path, init.text]);

    return (
        <FluentProvider theme={theme} className={styles.root}>
            <div style={{ display: 'flex', gap: 12, padding: 12, alignItems: 'center', minHeight: 56 }}>
                {loading && (
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12 }}>
                        <Spinner size='medium' />
                        <span style={{ fontSize: 12, opacity: .65 }}>解析中...</span>
                    </div>
                )}
                {!loading && parseResult && (
                    <Field style={{ minWidth: 220 }} label='转职 / GrowType'>
                        <Select
                            value={growIndex != null ? String(growIndex) : ''}
                            onChange={(_, data) => { if (data.value) setGrowIndex(Number(data.value)); }}
                        >
                            <option value='' disabled>选择...</option>
                            {(parseResult.allGrowTypeNames ?? []).map((n, i) => (
                                <option key={i} value={String(i)}>{n}</option>
                            ))}
                        </Select>
                    </Field>
                )}
            </div>
            {/* Spinner 模式无需额外动画样式 */}
            {parseResult && (
                <div className={styles.tabHeaderWrap}>
                    <TabList selectedValue={activeTab} onTabSelect={(_, data) => setActiveTab(String(data.value))}>
                        <Tab value='skills'>技能</Tab>
                        <Tab value='equip'>装备</Tab>
                    </TabList>
                </div>
            )}
            <div className={styles.tabContent}>
                {parseResult && activeTab === 'skills' && (
                    <>
                        <div className={styles.quickSlots}>
                            {Array.from({ length: MAX_SLOTS }).map((_, i) => {
                                const sk = quickSkills[i];
                                if (sk) {
                                    return (
                                        <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                                            <div className={styles.quickSlot}
                                                onMouseEnter={() => setHoverSlot(i)}
                                                onMouseLeave={() => setHoverSlot(h => (h === i ? null : h))}
                                                onClick={() => removeQuickAt(i)}
                                                title={(sk.skillName || '') + ' (点击移除)'}>
                                                {sk.iconBase64 && <img className={styles.skillImg} src={`data:image/png;base64,${sk.iconBase64}`} />}
                                                <span className={styles.levelBadge}>{sk.level}</span>
                                                {hoverSlot === i && <div className={styles.removeMask}>移除</div>}
                                            </div>
                                            <div style={{ display: 'flex', gap: 4 }}>
                                                <Button size='small' appearance='outline' style={{ minWidth: 20, padding: '0 4px', height: 22 }} onClick={(e) => { e.stopPropagation(); adjustQuickLevel(i, -1); }}>-</Button>
                                                <Button size='small' appearance='outline' style={{ minWidth: 20, padding: '0 4px', height: 22 }} onClick={(e) => { e.stopPropagation(); adjustQuickLevel(i, +1); }}>+</Button>
                                            </div>
                                        </div>
                                    );
                                }
                                return (
                                    <div key={i} className={styles.quickSlot + ' ' + styles.quickSlotEmpty}
                                        onClick={() => setDialogOpen(true)}
                                        title='添加技能'>
                                        <span className={styles.quickPlus}>+</span>
                                    </div>
                                );
                            })}
                        </div>
                        <div style={{ padding: '0 12px 4px 12px', fontSize: 12, opacity: .6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span>已掌握技能（不含快捷栏）</span>
                            <Button size='small' appearance='subtle' onClick={() => { setDialogMode('learned'); setDialogOpen(true); }}>添加</Button>
                        </div>
                        <div className={styles.learnedGrid}>
                            {displayLearned.map(s => (
                                <div key={s.id} className={styles.learnedItem} title={(s.skillName || '') + ' (点击移除)'}
                                    onMouseEnter={() => setHoverLearnedId(s.id)}
                                    onMouseLeave={() => setHoverLearnedId(h => h === s.id ? null : h)}
                                    >
                                    <div className={styles.learnedIconBox} onClick={() => removeLearnedSkill(s.id)}>
                                        {s.iconBase64 && <img className={styles.skillImg} src={`data:image/png;base64,${s.iconBase64}`} />}
                                        {s.level != null && <span className={styles.learnedLevel}>{s.level}</span>}
                                        {hoverLearnedId === s.id && <div className={styles.learnedRemoveMask}>移除</div>}
                                    </div>
                                    <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                                        <Button size='small' appearance='outline' style={{ minWidth: 20, padding: '0 4px', height: 22 }} onClick={() => adjustLearnedLevel(s.id, -1)}>-</Button>
                                        <Button size='small' appearance='outline' style={{ minWidth: 20, padding: '0 4px', height: 22 }} onClick={() => adjustLearnedLevel(s.id, +1)}>+</Button>
                                    </div>
                                    <span style={{ textAlign: 'center' }}>{(s.skillName || '').slice(0, 6)}</span>
                                </div>
                            ))}
                            <div key='add-tile' className={styles.learnedItem} title='添加技能'>
                                <div className={styles.learnedIconBox} style={{ border: '1px dashed #444', background: '#151515', cursor: 'pointer' }}
                                    onClick={() => { setDialogMode('learned'); setDialogOpen(true); }}>
                                    <span style={{ fontSize: 26, color: '#555' }}>+</span>
                                </div>
                                <span style={{ textAlign: 'center', opacity: .5 }}>添加</span>
                            </div>
                            {displayLearned.length === 0 && <div style={{ fontSize: 12, opacity: .5 }}>无其它技能</div>}
                        </div>
                    </>
                )}
                {parseResult && activeTab === 'equip' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ padding: '12px 12px 0 12px', fontSize: 12, opacity: .6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>装备列表 ({parseResult.equipments?.length || 0})</span>
                            {/* 预留未来的过滤 / 搜索栏位 */}
                        </div>
                        {(parseResult.equipments && parseResult.equipments.length > 0) ? (
                            <div className={styles.equipmentGrid}>
                                {parseResult.equipments.map(eq => (
                                    <div key={eq.id} className={styles.equipmentCard} title={(eq.name || '') + ' #' + eq.id}>
                                        <span className={styles.equipmentId}>#{eq.id}</span>
                                        <div className={styles.equipmentIconBox}>
                                            {eq.iconBase64 ? (
                                                <img className={styles.equipmentIcon} src={`data:image/png;base64,${eq.iconBase64}`} />
                                            ) : (
                                                <span style={{ fontSize: 10, opacity: .4 }}>无图标</span>
                                            )}
                                        </div>
                                        <div className={styles.equipmentName}>{eq.name || '未知名称'}</div>
                                        <div className={styles.equipmentBadges}>
                                            <span className={styles.equipmentBadge}>{eq.gradeName || '等级' + (eq.grade ?? '')}</span>
                                            {typeof eq.powerUpLevel === 'number' && <span className={styles.equipmentBadge}>+{eq.powerUpLevel}</span>}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div style={{ padding: '24px 12px', fontSize: 12, opacity: .5 }}>暂无装备数据</div>
                        )}
                    </div>
                )}
            </div>
            <Dialog open={dialogOpen} onOpenChange={(_, data) => setDialogOpen(!!data.open)} modalType="non-modal">
                <DialogSurface>
                    <DialogBody>
                        <DialogTitle action={<Button appearance='subtle' aria-label='关闭' onClick={() => setDialogOpen(false)} icon={<Dismiss24Regular />} />}>{dialogMode === 'quick' ? '添加快捷技能' : '添加已掌握技能'}</DialogTitle>
                        <DialogContent>
                            <div className={styles.searchRow} style={{ gap: '16px', flexWrap: 'wrap' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    <span style={{ fontSize: 12, opacity: .65 }}>技能等级</span>
                                    <Input type='number' value={String(selectedLevel)} style={{ width: 90 }}
                                        onChange={(_, data: any) => {
                                            const v = parseInt(data.value, 10);
                                            if (!isNaN(v)) setSelectedLevel(Math.max(1, Math.min(100, v)));
                                            else setSelectedLevel(1);
                                        }}
                                    />
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                                    <span style={{ fontSize: 12, opacity: .65 }}>搜索技能</span>
                                    <SearchBox
                                        className='apc-no-focus-outline'
                                        placeholder='输入名称过滤'
                                        value={query}
                                        onChange={(_, d: any) => setQuery(d.value)}
                                        style={{ width: '100%' }}
                                    />
                                </div>
                            </div>
                            <div className={styles.suggPanel}>
                                {filteredAll.map(s => (
                                    <div key={s.id} className={styles.suggItem}
                                        onMouseEnter={e => e.currentTarget.classList.add(styles.suggItemHoverState)}
                                        onMouseLeave={e => e.currentTarget.classList.remove(styles.suggItemHoverState)}
                                        onClick={() => (dialogMode === 'quick' ? addQuickSkill(s) : addLearnedSkill(s))}
                                        title={s.skillName || String(s.id)}>
                                        <div className={styles.suggIconBox}>
                                            {s.iconBase64 && <img style={{ maxWidth: '100%', maxHeight: '100%', imageRendering: 'pixelated' }} src={`data:image/png;base64,${s.iconBase64}`} />}
                                        </div>
                                        <span style={{ flex: 1 }}>{s.skillName || s.id}</span>
                                        <span style={{ opacity: .5 }}>#{s.id}</span>
                                    </div>
                                ))}
                                {filteredAll.length === 0 && <div style={{ padding: '6px 4px', fontSize: 12, opacity: .6 }}>无匹配技能</div>}
                            </div>
                        </DialogContent>
                        <DialogActions>
                            <Button appearance='primary' onClick={() => { setDialogOpen(false); }}>完成</Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>
        </FluentProvider>
    );
};

function main() {
    const root = document.getElementById('root'); if (!root) return;
    window.addEventListener('error', e => console.error('[APCEditor Error]', e.error || e.message));
    window.addEventListener('unhandledrejection', (e: any) => console.error('[APCEditor Unhandled]', e.reason));
    // init
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const init: InitData = (window as any).__INIT;
    createRoot(root).render(<App init={init} />);
}
main();
