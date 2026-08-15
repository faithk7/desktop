import { CloningRepository } from './cloning-repository'
import { CloneOptions } from './clone-options'
import { ICloneProgress } from './progress'

export type CloneQueueStatus = 'active' | 'failed'

export interface ICloneQueueEntry {
  readonly id: number
  readonly name: string
  readonly url: string
  readonly path: string
  readonly options: CloneOptions
  readonly status: CloneQueueStatus
  readonly repository: CloningRepository | null
  readonly progress: ICloneProgress | null
  readonly error: string | null
}
