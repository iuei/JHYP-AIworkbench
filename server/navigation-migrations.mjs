export const quickNavigationSeed = [
  {
    category: null,
    items: [
      { name: '积加 ERP', url: 'https://oumai.app.gerpgo.com/' },
      { name: '阿里邮箱企业版', url: 'https://qiye.aliyun.com/' },
      { name: '坚果云网页版', url: 'https://www.jianguoyun.com/' },
    ],
  },
  {
    category: '常用查询',
    items: [
      { name: '海关编码', url: 'https://www.hsbianma.com/', description: '海关编码查询、商品归类与进出口申报参考', tags: ['报关', '编码查询'] },
      { name: '美国商标查询入口', url: 'https://tmsearch.uspto.gov/search/search-information', description: '美国官方商标检索、可用性查询平台', tags: ['商标', '美国'] },
      { name: '欧盟商标局入口', url: 'https://euipo.europa.eu/ohimportal/en/search-availability', description: '欧盟商标官方查询、注册状态检索工具', tags: ['商标', '欧盟'] },
      { name: '商标查询 51IP', url: 'https://www.ip51.com/brand/search', description: '跨境电商专利查询、侵权风险检测', tags: ['推荐', '快捷'] },
      { name: '睿观查专利', url: 'https://detect.eric-bot.com/eric', description: '跨境电商专利查询、侵权风险检测', tags: ['专利', '风控'] },
      { name: '智慧芽', url: 'https://account.zhihuiya.com/', description: '专业专利检索、知识产权数据库平台', tags: ['查专利'] },
    ],
  },
  {
    category: '飞书常用应用',
    items: [
      { name: '新品开发需求收集表单', url: 'https://jinghuyoupin.feishu.cn/share/base/form/shrcnT6VemfrTVMjtDlvCVuIq4c', description: '新品开发需求提报、收集与汇总', tags: ['表单', '需求管理'] },
      { name: '产品开发系统v1.0', url: 'https://jinghuyoupin.feishu.cn/wiki/TnPUwv2U5isQ1HkQUfTcu85BnOh?from=from_copylink', description: '产品开发全流程协作', tags: ['飞书', '项目管理'] },
    ],
  },
  {
    category: '产品宝典',
    items: [
      { name: 'SKU命名+图片+产品名规范', url: 'https://jinghuyoupin.feishu.cn/docx/HjQCdYIsJoJDB8x4236cJK3ynOg?from=from_copylink', description: 'SKU命名、图片、产品名统一规范文档', tags: ['规范', '产品管理'] },
    ],
  },
  {
    category: '物流宝典',
    items: [
      { name: '中国海关编码查询网站', url: 'https://www.hsbianma.com/Home/Message', description: '海关编码查询、商品归类与报关参考', tags: ['报关', '编码查询'] },
      { name: '备货的报关方式区分及要求', url: 'https://jinghuyoupin.feishu.cn/wiki/EVcsw22vUiAWaFk01KicfEgdnqf', description: '备货报关方式说明与操作要求', tags: ['物流', '报关规范'] },
    ],
  },
  {
    category: '规章制度',
    items: [
      { name: '人生・事业的结果=思维方式×热情×能力', url: 'https://jinghuyoupin.feishu.cn/wiki/VjnUwCUJriuY6Ek9qN8c1E1ynQh', description: '企业文化与工作理念学习文档', tags: ['文化', '理念'] },
    ],
  },
  {
    category: '模板库',
    items: [
      { name: '新增 SKU 模板 （飞书云文档-模板库）', url: 'https://jinghuyoupin.feishu.cn/drive/folder/FzDifq2PdlDBiBd7eB4cPywrnPe', description: '新增SKU标准模板与填写规范', tags: ['模板', 'SKU管理'] },
    ],
  },
]

async function existingCategoryId(client, name) {
  const { rows } = await client.query(
    'SELECT id FROM navigation_categories WHERE name = $1',
    [name]
  )
  return rows[0]?.id
}

async function existingTagId(client, name) {
  const { rows } = await client.query(
    'SELECT id FROM navigation_tags WHERE name = $1',
    [name]
  )
  return rows[0]?.id
}

async function seedQuickNavigation(client) {
  const tagIds = new Map()
  for (const [groupIndex, group] of quickNavigationSeed.entries()) {
    let categoryId = null
    if (group.category) {
      const category = await client.query(
        'INSERT INTO navigation_categories (name, sort_order) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING RETURNING id',
        [group.category, groupIndex - 1]
      )
      categoryId =
        category.rows[0]?.id ??
        (await existingCategoryId(client, group.category))
    }
    for (const [itemIndex, item] of group.items.entries()) {
      const navigationItem = await client.query(
        `INSERT INTO navigation_items
          (category_id, name, url, description, placement, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (name, url) DO NOTHING RETURNING id`,
        [
          categoryId,
          item.name,
          item.url,
          item.description ?? '',
          group.category ? 'category' : 'featured',
          itemIndex,
        ]
      )
      const itemId =
        navigationItem.rows[0]?.id ??
        (
          await client.query(
            'SELECT id FROM navigation_items WHERE name = $1 AND url = $2',
            [item.name, item.url]
          )
        ).rows[0].id

      for (const [tagIndex, tagName] of (item.tags ?? []).entries()) {
        if (!tagIds.has(tagName)) {
          const tag = await client.query(
            'INSERT INTO navigation_tags (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING id',
            [tagName]
          )
          tagIds.set(
            tagName,
            tag.rows[0]?.id ?? (await existingTagId(client, tagName))
          )
        }
        await client.query(
          'INSERT INTO navigation_item_tags (item_id, tag_id, sort_order) VALUES ($1, $2, $3) ON CONFLICT (item_id, tag_id) DO NOTHING',
          [itemId, tagIds.get(tagName), tagIndex]
        )
      }
    }
  }
}

async function createQuickNavigationSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS navigation_categories (
      id SERIAL PRIMARY KEY, name VARCHAR(80) UNIQUE NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS navigation_tags (
      id SERIAL PRIMARY KEY, name VARCHAR(40) UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS navigation_items (
      id SERIAL PRIMARY KEY,
      category_id INTEGER REFERENCES navigation_categories(id) ON DELETE RESTRICT,
      name VARCHAR(120) NOT NULL, url TEXT NOT NULL,
      description VARCHAR(300) NOT NULL DEFAULT '',
      placement VARCHAR(20) NOT NULL CHECK (placement IN ('featured', 'category')),
      sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (name, url),
      CHECK ((placement = 'featured' AND category_id IS NULL) OR (placement = 'category' AND category_id IS NOT NULL))
    );
    CREATE TABLE IF NOT EXISTS navigation_item_tags (
      item_id INTEGER NOT NULL REFERENCES navigation_items(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES navigation_tags(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
      PRIMARY KEY (item_id, tag_id)
    );
    CREATE INDEX IF NOT EXISTS navigation_items_category_id_idx
      ON navigation_items(category_id);
    CREATE INDEX IF NOT EXISTS navigation_item_tags_tag_id_idx
      ON navigation_item_tags(tag_id);
  `)
  await seedQuickNavigation(client)
}

export const navigationMigrations = [
  {
    version: 1,
    name: 'create_and_seed_quick_navigation',
    up: createQuickNavigationSchema,
  },
]

export async function runNavigationMigrations(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name VARCHAR(160) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  for (const migration of navigationMigrations) {
    await client.query('BEGIN')
    try {
      await client.query('LOCK TABLE schema_migrations IN EXCLUSIVE MODE')
      const applied = await client.query(
        'SELECT 1 FROM schema_migrations WHERE version = $1',
        [migration.version]
      )
      if (!applied.rowCount) {
        await migration.up(client)
        await client.query(
          'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
          [migration.version, migration.name]
        )
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    }
  }
}
