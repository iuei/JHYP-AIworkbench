import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { FreshnessBar } from './components/citation-panel'

describe('FreshnessBar 来源声明', () => {
  it('业务数据引用显示数据集，不计为知识库文档', async () => {
    const { container } = await render(
      <FreshnessBar
        citations={[
          {
            kind: 'dataset',
            dataset: 'amazon_ads_daily',
            title: 'Amazon 广告日报',
            sourceType: 'dataset',
            importedAt: '2026-09-17T00:00:00.000Z',
            updatedAt: '2026-09-17T00:00:00.000Z',
          },
        ]}
      />
    )

    expect(container.textContent).toContain('业务数据集（Amazon 广告日报）')
    expect(container.textContent).not.toContain('企业知识库（1 篇文档）')
  })

  it('混合引用分别显示知识库文档与业务数据集', async () => {
    const { container } = await render(
      <FreshnessBar
        citations={[
          {
            kind: 'document',
            documentId: 7,
            title: '补货 SOP',
            sourceType: 'upload',
            updatedAt: '2026-09-16T00:00:00.000Z',
          },
          {
            kind: 'dataset',
            dataset: 'amazon_sales_daily',
            title: 'Amazon 销售日报',
            sourceType: 'dataset',
            importedAt: '2026-09-17T00:00:00.000Z',
            updatedAt: '2026-09-17T00:00:00.000Z',
          },
        ]}
      />
    )

    expect(container.textContent).toContain('企业知识库（1 篇文档）')
    expect(container.textContent).toContain('业务数据集（Amazon 销售日报）')
  })
})
