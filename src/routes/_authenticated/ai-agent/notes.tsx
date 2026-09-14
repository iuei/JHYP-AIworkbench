import { createFileRoute } from '@tanstack/react-router'
import { NoteSpace } from '@/features/ai-agent/pages/note-space'

/** 「我的知识沉淀」：全员可用，账号级隔离由服务端接口保证。 */
export const Route = createFileRoute('/_authenticated/ai-agent/notes')({
  component: NoteSpace,
})
