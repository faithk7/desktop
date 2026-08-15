import { CloningRepository } from '../../models/cloning-repository'
import { ICloneProgress } from '../../models/progress'
import { CloneOptions } from '../../models/clone-options'
import { RetryAction, RetryActionType } from '../../models/retry-actions'
import { ICloneQueueEntry } from '../../models/clone-queue'

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
  private readonly queueByID = new Map<number, ICloneQueueEntry>()

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
    this.queueByID.set(repository.id, {
      id: repository.id,
      name: repository.name,
      url,
      path,
      options,
      status: 'active',
      repository,
      progress: { kind: 'clone', title, value: 0 },
      error: null,
    })
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
          const queueEntry = this.queueByID.get(repository.id)
          if (queueEntry !== undefined) {
            this.queueByID.set(repository.id, {
              ...queueEntry,
              progress,
            })
          }
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

        const error = e instanceof Error ? e.message : String(e)
        this.queueByID.set(repository.id, {
          id: repository.id,
          name: repository.name,
          url,
          path,
          options,
          status: 'failed',
          repository: null,
          progress: this.stateByID.get(repository.id) ?? null,
          error,
        })

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

  /** Get active and failed clone jobs for the current app session. */
  public get queue(): ReadonlyArray<ICloneQueueEntry> {
    return Array.from(this.queueByID.values())
  }

  /** Retry a failed clone, optionally using a new destination. */
  public retry(
    id: number,
    path?: string
  ): { promise: Promise<boolean>; repository: CloningRepository } | null {
    const entry = this.queueByID.get(id)
    if (entry === undefined || entry.status !== 'failed') {
      return null
    }

    this.queueByID.delete(id)
    this.emitUpdate()

    const retryPath = path ?? entry.path
    const promise = this.clone(entry.url, retryPath, entry.options)
    const repository = this._repositories.find(
      candidate => candidate.url === entry.url && candidate.path === retryPath
    )

    return repository === undefined ? null : { promise, repository }
  }

  /** Dismiss a failed clone from the current session's queue. */
  public dismiss(id: number) {
    const entry = this.queueByID.get(id)
    if (entry?.status !== 'failed') {
      return
    }

    this.queueByID.delete(id)
    this.emitUpdate()
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

    const queueEntry = this.queueByID.get(repository.id)
    if (queueEntry?.status === 'active') {
      this.queueByID.delete(repository.id)
    }

    const repoIndex = this._repositories.findIndex(r => r.id === repository.id)
    if (repoIndex > -1) {
      this._repositories.splice(repoIndex, 1)
    }

    this.emitUpdate()
  }
}
