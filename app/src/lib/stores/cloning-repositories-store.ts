import { CloningRepository } from '../../models/cloning-repository'
import { ICloneProgress } from '../../models/progress'
import { CloneOptions } from '../../models/clone-options'
import { RetryAction, RetryActionType } from '../../models/retry-actions'

import { clone as cloneRepo } from '../git'
import { ErrorWithMetadata } from '../error-with-metadata'
import { BaseStore } from './base-store'
import { pathExists } from '../path-exists'
import { rm } from 'fs/promises'

/** The store in charge of repository currently being cloned. */
export class CloningRepositoriesStore extends BaseStore {
  private readonly _repositories = new Array<CloningRepository>()
  private readonly stateByID = new Map<number, ICloneProgress>()
  private readonly abortControllerByID = new Map<number, AbortController>()
  private readonly cancelledRepositoryIDs = new Set<number>()

  /**
   * Clone the repository at the URL to the path.
   *
   * Returns a {Promise} which resolves to whether the clone was successful.
   */
  public async clone(
    url: string,
    path: string,
    options: CloneOptions
  ): Promise<boolean> {
    const repository = new CloningRepository(path, url)
    this._repositories.push(repository)
    const abortController = new AbortController()
    this.abortControllerByID.set(repository.id, abortController)

    const title = `Cloning into ${path}`

    this.stateByID.set(repository.id, { kind: 'clone', title, value: 0 })
    this.emitUpdate()

    const destinationExisted = await pathExists(path)

    let success = true
    try {
      await cloneRepo(
        url,
        path,
        options,
        progress => {
          this.stateByID.set(repository.id, progress)
          this.emitUpdate()
        },
        abortController.signal
      )
    } catch (e) {
      success = false

      if (!this.cancelledRepositoryIDs.has(repository.id)) {
        const retryAction: RetryAction = {
          type: RetryActionType.Clone,
          name: repository.name,
          url,
          path,
          options,
        }
        e = new ErrorWithMetadata(e, { retryAction, repository })

        this.emitError(e)
      }
    }

    const wasCancelled = this.cancelledRepositoryIDs.has(repository.id)
    this.remove(repository)
    this.abortControllerByID.delete(repository.id)
    this.cancelledRepositoryIDs.delete(repository.id)

    if (wasCancelled && !destinationExisted) {
      try {
        await rm(path, { recursive: true, force: true })
      } catch (error) {
        log.warn(`Unable to remove cancelled clone at ${path}`, error)
      }
    }

    return success
  }

  /** Cancel an active clone and remove its incomplete destination. */
  public cancel(repository: CloningRepository) {
    if (!this.stateByID.has(repository.id)) {
      return
    }

    this.cancelledRepositoryIDs.add(repository.id)
    this.abortControllerByID.get(repository.id)?.abort()
  }

  /** Get the repositories currently being cloned. */
  public get repositories(): ReadonlyArray<CloningRepository> {
    return Array.from(this._repositories)
  }

  /** Get a snapshot of every active clone's progress, keyed by repository id. */
  public get repositoryStateLookup(): ReadonlyMap<number, ICloneProgress> {
    return new Map(this.stateByID)
  }

  /** Get the state of the repository. */
  public getRepositoryState(
    repository: CloningRepository
  ): ICloneProgress | null {
    return this.stateByID.get(repository.id) || null
  }

  /** Remove the repository. */
  public remove(repository: CloningRepository) {
    this.stateByID.delete(repository.id)

    const repoIndex = this._repositories.findIndex(r => r.id === repository.id)
    if (repoIndex > -1) {
      this._repositories.splice(repoIndex, 1)
    }

    this.emitUpdate()
  }
}
