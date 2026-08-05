import { describe, it } from 'node:test'
import assert from 'node:assert'

import { Repository } from '../../src/models/repository'
import { generateRepositoryListContextMenu } from '../../src/ui/repositories-list/repository-list-item-context-menu'

describe('repository list item context menu', () => {
  it('offers a current-branch view reset with the supplied availability', () => {
    const repository = new Repository('/some/repository', 1, null, false)
    let resetRepository: Repository | null = null
    const items = generateRepositoryListContextMenu({
      repository,
      shellLabel: undefined,
      externalEditorLabel: undefined,
      askForConfirmationOnRemoveRepository: true,
      onViewOnGitHub: () => {},
      onOpenInShell: () => {},
      onShowRepository: () => {},
      onOpenInExternalEditor: () => {},
      onRemoveRepository: () => {},
      onChangeRepositoryAlias: () => {},
      onRemoveRepositoryAlias: () => {},
      onResetCurrentBranchView: repo => {
        resetRepository = repo
      },
      canResetCurrentBranchView: () => true,
    })

    const resetItem = items.find(
      item =>
        'label' in item &&
        typeof item.label === 'string' &&
        item.label.toLocaleLowerCase() === 'reset current branch view'
    )
    assert(resetItem !== undefined && 'action' in resetItem)
    assert.equal(resetItem.enabled, true)
    resetItem.action?.()
    assert.equal(resetRepository, repository)
  })

  it('disables reset when the current branch has no saved view', () => {
    const repository = new Repository('/some/repository', 1, null, false)
    const items = generateRepositoryListContextMenu({
      repository,
      shellLabel: undefined,
      externalEditorLabel: undefined,
      askForConfirmationOnRemoveRepository: true,
      onViewOnGitHub: () => {},
      onOpenInShell: () => {},
      onShowRepository: () => {},
      onOpenInExternalEditor: () => {},
      onRemoveRepository: () => {},
      onChangeRepositoryAlias: () => {},
      onRemoveRepositoryAlias: () => {},
      onResetCurrentBranchView: () => {},
      canResetCurrentBranchView: () => false,
    })

    const resetItem = items.find(
      item =>
        'label' in item &&
        typeof item.label === 'string' &&
        item.label.toLocaleLowerCase() === 'reset current branch view'
    )
    assert(resetItem !== undefined && 'enabled' in resetItem)
    assert.equal(resetItem.enabled, false)
  })
})
