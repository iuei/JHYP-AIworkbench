import { ContentSection } from '../components/content-section'
import { AccountForm } from './account-form'

export function SettingsAccount() {
  return (
    <ContentSection
      title='账户'
      desc='查看和维护内部账户基础信息。'
    >
      <AccountForm />
    </ContentSection>
  )
}
