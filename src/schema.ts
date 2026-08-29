// Vendored subset of the Standard Schema v1 interface (https://standardschema.dev),
// inlined to keep this package dependency-free. Structurally identical to
// `@standard-schema/spec`, so schemas from zod / valibot / arktype still satisfy it.

/** The Standard Schema interface. */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': StandardSchemaV1.Props<Input, Output>
}

export namespace StandardSchemaV1 {
  export interface Props<Input = unknown, Output = Input> {
    /** The version number of the standard. */
    readonly version: 1
    /** The vendor name of the schema library. */
    readonly vendor: string
    /** Inferred types associated with the schema. */
    readonly types?: Types<Input, Output> | undefined
    /** Validates unknown input values. */
    readonly validate: (value: unknown, options?: Options | undefined) => Result<Output> | Promise<Result<Output>>
  }

  export interface Types<Input = unknown, Output = Input> {
    readonly input: Input
    readonly output: Output
  }

  export interface Options {
    readonly libraryOptions?: Record<string, unknown> | undefined
  }

  export type Result<Output> = SuccessResult<Output> | FailureResult

  export interface SuccessResult<Output> {
    readonly value: Output
    /** A falsy value for `issues` indicates success. */
    readonly issues?: undefined
  }

  export interface FailureResult {
    readonly issues: ReadonlyArray<Issue>
  }

  export interface Issue {
    readonly message: string
    readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined
  }

  export interface PathSegment {
    readonly key: PropertyKey
  }

  export type InferInput<Schema extends StandardSchemaV1> = NonNullable<Schema['~standard']['types']>['input']
  export type InferOutput<Schema extends StandardSchemaV1> = NonNullable<Schema['~standard']['types']>['output']
}
