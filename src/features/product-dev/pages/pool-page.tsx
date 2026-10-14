import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TABLE_SEARCH_ICON, TABLE_SEARCH_INPUT } from '@/lib/table-styles'
import {
  createCandidate,
  deleteCandidate,
  fetchCandidates,
  updateCandidate,
} from '../api'
import { CandidateFormDialog } from '../components/candidate-form-dialog'
import { CandidateImportDialog } from '../components/candidate-import-dialog'
import { CandidateTable } from '../components/candidate-table'
import { ALL, DEFAULT_PAGE_SIZE, KEYWORD_DEBOUNCE_MS } from '../constants'
import { useProductDev } from '../dev-context'
import { CANDIDATE_MARKETPLACE_OPTIONS, apiErrorMessage } from '../format'
import type { Candidate, CandidateFormValues } from '../types'

/**
 * 「产品开发 → 候选池」子页（2026-09-16 阶段 B 由单页页签改为独立路由）。
 *
 * 只做一件事：检索与维护候选产品。选中集合与对比结果都不在这里 —— 它们跨子页共享，
 * 由 `ProductDevLayout` 经 context 提供（见 `dev-context.ts` 的说明）。
 *
 * 检索条件（关键词 / 站点 / 阶段 / 页码）**刻意留在本子页**：它们只影响候选池这一屏，
 * 切到对比页再回来时重新筛选是符合预期的，上提反而会让"回来还是上次的筛选"变得不可解释。
 */
export function ProductDevPoolPage() {
  const queryClient = useQueryClient()
  const {
    selected,
    selectedList,
    toggleSelect,
    toggleSelectMany,
    replaceSelected,
    removeSelected,
    clearSelection,
  } = useProductDev()

  // 检索条件
  const [keyword, setKeyword] = useState('')
  const [queryKeyword, setQueryKeyword] = useState('')
  const [marketplace, setMarketplace] = useState(ALL)
  const [stage, setStage] = useState(ALL)
  const [page, setPage] = useState(1)

  // 每页条数固定：候选池的检索由服务端完成，切换每页条数对使用体验没有实质帮助，
  // 少一个状态就少一处需要同步的地方（需要时再补 onPageSizeChange）。
  const pageSize = DEFAULT_PAGE_SIZE

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Candidate | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Candidate | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      setQueryKeyword(keyword.trim())
      setPage(1)
    }, KEYWORD_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [keyword])

  const candidates = useQuery({
    queryKey: ['product-dev-candidates', queryKeyword, marketplace, stage, page, pageSize],
    queryFn: () =>
      fetchCandidates({
        keyword: queryKeyword,
        marketplace: marketplace === ALL ? null : marketplace,
        stage: stage === ALL ? null : (stage as Candidate['stage']),
        page,
        pageSize,
      }),
  })

  function invalidateCandidates() {
    void queryClient.invalidateQueries({ queryKey: ['product-dev-candidates'] })
  }

  const saveCandidate = useMutation({
    mutationFn: (values: CandidateFormValues) =>
      editing ? updateCandidate(editing.id, values) : createCandidate(values),
    onSuccess: (saved) => {
      toast.success(editing ? '候选已更新。' : '候选已加入候选池。')
      setFormOpen(false)
      setEditing(null)
      invalidateCandidates()
      // 编辑的是已选中的候选时，同步对比页显示的名称（只换对象，不动选中状态）
      replaceSelected(saved)
    },
    onError: (error) => {
      toast.error(apiErrorMessage(error, '保存失败，请检查填写内容。'))
    },
  })

  const removeCandidate = useMutation({
    mutationFn: (id: number) => deleteCandidate(id),
    onSuccess: (_data, id) => {
      toast.success('候选已删除。')
      setPendingDelete(null)
      // 删掉的若是已选中的候选，把它从选择里摘掉（否则对比页会留着一条已不存在的候选）
      removeSelected(id)
      invalidateCandidates()
    },
    onError: (error) => {
      toast.error(apiErrorMessage(error, '删除失败，请稍后重试。'))
    },
  })

  function toggleSelectAll() {
    // 全选语义交给 context 一次完成：逐条 toggleSelect 会在超上限时连弹多次提示，
    // 而且每次都是一轮 setState。
    toggleSelectMany(candidates.data?.items ?? [])
  }

  const hasFilters = Boolean(queryKeyword) || marketplace !== ALL || stage !== ALL

  return (
    <>
      <CandidateTable
        items={candidates.data?.items ?? []}
        total={candidates.data?.total ?? 0}
        loading={candidates.isLoading}
        refreshing={candidates.isFetching}
        error={candidates.error}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        hasFilters={hasFilters}
        selectedIds={new Set(selected.keys())}
        onToggle={(id) => {
          const item = candidates.data?.items.find((candidate) => candidate.id === id)
          if (item) toggleSelect(item)
        }}
        onToggleAll={toggleSelectAll}
        onEdit={(candidate) => {
          setEditing(candidate)
          setFormOpen(true)
        }}
        onDelete={setPendingDelete}
        toolbar={
          <div className='flex flex-wrap items-center gap-2'>
            <div className='relative'>
              <Search
                aria-hidden='true'
                className={`pointer-events-none absolute top-1/2 size-4 -translate-y-1/2 text-muted-foreground ${TABLE_SEARCH_ICON}`}
              />
              <Input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder='搜索产品名称、ASIN、类目、备注'
                aria-label='搜索候选产品'
                className={`w-64 ${TABLE_SEARCH_INPUT}`}
              />
            </div>

            <Select
              value={marketplace}
              onValueChange={(value) => {
                setMarketplace(value)
                setPage(1)
              }}
            >
              <SelectTrigger className='w-36' aria-label='按站点筛选'>
                <SelectValue placeholder='全部站点' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>全部站点</SelectItem>
                {CANDIDATE_MARKETPLACE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={stage}
              onValueChange={(value) => {
                setStage(value)
                setPage(1)
              }}
            >
              <SelectTrigger className='w-32' aria-label='按阶段筛选'>
                <SelectValue placeholder='全部阶段' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>全部阶段</SelectItem>
                {(candidates.data?.stages ?? []).map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {(hasFilters || selectedList.length > 0) && (
              <Button
                type='button'
                variant='ghost'
                size='sm'
                onClick={() => {
                  setKeyword('')
                  setMarketplace(ALL)
                  setStage(ALL)
                  clearSelection()
                }}
              >
                <X aria-hidden='true' />
                清空筛选与选择
              </Button>
            )}

            <div className='ms-auto flex flex-wrap items-center gap-2'>
              {selectedList.length > 0 && (
                <Badge variant='secondary'>已选 {selectedList.length}</Badge>
              )}
              <Button
                type='button'
                variant='outline'
                onClick={() => setImportOpen(true)}
              >
                <Upload aria-hidden='true' />
                导入表格
              </Button>
              <Button
                type='button'
                onClick={() => {
                  setEditing(null)
                  setFormOpen(true)
                }}
              >
                <Plus aria-hidden='true' />
                新增候选
              </Button>
            </div>
          </div>
        }
      />

      {/*
        key 让「每次打开都是一个新实例」：表单初值在挂载时取一次即可，
        不需要在弹窗内部用 effect 同步 open/props（那会多一轮渲染，也被 lint 规则拦）。
        编辑不同候选时 key 也会变，因此不会残留上一条候选的字段。
      */}
      <CandidateFormDialog
        key={formOpen ? `open-${editing?.id ?? 'new'}` : 'closed'}
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open)
          if (!open) setEditing(null)
        }}
        candidate={editing}
        pending={saveCandidate.isPending}
        onSubmit={(values) => saveCandidate.mutate(values)}
      />

      <CandidateImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        maxImportRows={candidates.data?.maxImportRows ?? 2000}
        onImported={invalidateCandidates}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title='删除候选产品'
        desc={`确认从候选池移除「${
          pendingDelete?.product_name || pendingDelete?.asin || ''
        }」吗？删除后可以重新添加同一个 ASIN。`}
        confirmText='删除'
        destructive
        isLoading={removeCandidate.isPending}
        handleConfirm={() => pendingDelete && removeCandidate.mutate(pendingDelete.id)}
      />
    </>
  )
}
