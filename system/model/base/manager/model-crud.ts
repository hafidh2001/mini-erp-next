import type { PaginationParams, PaginationResult } from "../../../types";
import type { ModelState } from "../../model";
import type { BaseRecord } from "../model-base";
import { ModelManager } from "../model-manager";

export abstract class ModelCrud<
  T extends BaseRecord = any
> extends ModelManager<T> {
  protected state!: ModelState<T>;

  protected abstract ensurePrimaryKeys(
    select: Record<string, any>
  ): Record<string, any>;
  protected abstract getSelectFields(
    select?: Record<string, any> | string[]
  ): string[];
  protected abstract invalidateCache(id?: string): void;
  protected abstract cacheRecordAndRelations(
    record: Record<string, any>,
    select?: Record<string, any> | string[]
  ): Promise<void>;
  protected abstract attachCachedRelations(
    record: Record<string, any>
  ): Promise<any>;

  protected shouldUseCache(): boolean {
    return this.state.mode === "client" && !!this.state.config?.cache?.ttl;
  }

  get prismaTable() {
    const prismaModelName =
      this.config.modelName.charAt(0).toLowerCase() +
      this.config.modelName.slice(1);

    return (this.prisma as any)[prismaModelName] as any;
  }

  async findFirst(
    idOrParams: string | Partial<PaginationParams>
  ): Promise<T | null> {
    const isString = typeof idOrParams === "string";
    const stringId = isString ? idOrParams : undefined;
    const params = isString ? { where: { id: stringId } } : idOrParams;

    // Check for ID in either string parameter or where clause
    const id = stringId || (params.where?.id as string | undefined);

    const shouldCache = params.useCache ?? this.shouldUseCache();
    if (id && shouldCache) {
      try {
        const cachedItem = this.state.modelCache.get<T>(
          this.state.config.modelName,
          id
        );
        if (cachedItem) {
          return cachedItem;
        }
      } catch (error) {
        console.error("Cache read error:", error);
      }
    }

    let queryParams = { ...params };

    if (Array.isArray(params.select)) {
      queryParams.select = params.select.reduce(
        (acc: Record<string, boolean>, field: string) => {
          acc[field] = true;
          return acc;
        },
        {}
      );
    }

    const record = await this.prismaTable.findFirst(queryParams);

    if (record && shouldCache) {
      try {
        await this.cacheRecordAndRelations(record, params.select);
      } catch (error) {}
    }

    return record as T | null;
  }

  async findMany(
    params: Partial<
      Omit<PaginationParams, "page" | "perPage"> & {
        select?: Record<string, any> | string[];
        include?: Record<string, any>;
        orderBy?: any;
      }
    > = {}
  ): Promise<T[]> {
    let queryParams = { ...params };
    const ids = params.where?.id ? [params.where.id] : params.where?.id?.in;

    if (Array.isArray(params.select)) {
      queryParams.select = params.select.reduce(
        (acc: Record<string, boolean>, field: string) => {
          acc[field] = true;
          return acc;
        },
        {}
      );
    }

    let results: T[] = [];
    const shouldCache = params.useCache ?? this.shouldUseCache();

    const enhancedSelect = queryParams.select
      ? this.ensurePrimaryKeys(queryParams.select)
      : undefined;

    results = await this.prismaTable.findMany({
      ...queryParams,
      select: enhancedSelect,
    });

    if (shouldCache && results.length) {
      await Promise.all(
        results.map((record: any) =>
          this.cacheRecordAndRelations(record, params.select)
        )
      );
    }

    return results;
  }

  async findList(
    params: Partial<
      PaginationParams & {
        select?: Record<string, any> | string[];
        include?: Record<string, any>;
        orderBy?: any;
      }
    > = {}
  ): Promise<PaginationResult<T>> {
    let queryParams = { ...params };
    const page = queryParams.page || 1;
    const perPage = queryParams.perPage || 10;
    const ids = params.where?.id ? [params.where.id] : params.where?.id?.in;

    if (Array.isArray(queryParams.select)) {
      queryParams.select = queryParams.select.reduce(
        (acc: Record<string, boolean>, field: string) => {
          acc[field] = true;
          return acc;
        },
        {}
      );
    }

    let records: T[] = [];
    let totalCount = 0;

    const shouldCache = params.useCache ?? this.shouldUseCache();

    const enhancedSelect = queryParams.select
      ? this.ensurePrimaryKeys(queryParams.select)
      : undefined;

    const skip = (page - 1) * perPage;

    const [dbRecords, count] = await Promise.all([
      this.prismaTable.findMany({
        ...queryParams,
        select: enhancedSelect,
        skip,
        take: perPage,
      }),
      this.prismaTable.count({ where: queryParams.where }),
    ]);

    records = ids ? [...records, ...dbRecords] : dbRecords;
    totalCount = count;

    if (shouldCache && records.length) {
      await Promise.all(
        records.map((record: any) =>
          this.cacheRecordAndRelations(record, queryParams.select)
        )
      );
    }

    return {
      data: records,
      page,
      perPage,
      total: totalCount,
      totalPages: Math.ceil(totalCount / perPage),
    };
  }

  async create(params: {
    data: Partial<T>;
    select?: Record<string, any> | string[];
    useCache?: boolean;
  }): Promise<T> {
    const { data, select, useCache } = params;

    const enhancedSelect = select ? this.ensurePrimaryKeys(select) : undefined;

    // Cleanse data by removing unwanted fields
    const cleanData = { ...data };

    // Remove the primary key from data if it exists
    delete cleanData[this.config.primaryKey];

    // Remove empty relation arrays
    for (const relation of Object.keys(this.state.config.relations || {})) {
      if (
        Array.isArray(cleanData[relation]) &&
        cleanData[relation].length === 0
      ) {
        delete cleanData[relation];
      }
    }

    // Only keep fields that are defined in the model columns
    const validFields = Object.keys(this.state.config.columns);
    Object.keys(cleanData).forEach((key) => {
      if (!validFields.includes(key)) {
        delete cleanData[key];
      }
    });

    const result = await this.prismaTable.create({
      data: cleanData,
      select: enhancedSelect,
    });

    const shouldCache = useCache ?? this.shouldUseCache();
    if (shouldCache) {
      await this.cacheRecordAndRelations(result, select);
    }

    return result as T;
  }

  async update(params: {
    where: { [key: string]: any };
    data: Partial<T>;
    select?: Record<string, any> | string[];
    useCache?: boolean;
  }): Promise<T> {
    const { where, data, select, useCache } = params;

    const enhancedSelect = select ? this.ensurePrimaryKeys(select) : undefined;

    // Cleanse data by removing unwanted fields
    const cleanData = { ...data };

    // Remove the primary key from data if it exists
    delete cleanData[this.config.primaryKey];

    // Remove empty relation arrays
    for (const relation of Object.keys(this.state.config.relations || {})) {
      if (
        Array.isArray(cleanData[relation]) &&
        cleanData[relation].length === 0
      ) {
        delete cleanData[relation];
      }
    }

    // Only keep fields that are defined in the model columns
    const validFields = Object.keys(this.state.config.columns);
    Object.keys(cleanData).forEach((key) => {
      if (!validFields.includes(key)) {
        delete cleanData[key];
      }
    });

    const result = await this.prismaTable.update({
      where,
      data: cleanData,
      select: enhancedSelect,
    });

    const shouldCache = useCache ?? this.shouldUseCache();
    if (shouldCache) {
      await this.cacheRecordAndRelations(result, select);
    }

    return result as T;
  }

  async delete(params: {
    where: { [key: string]: any };
    select?: Record<string, any> | string[];
    useCache?: boolean;
  }): Promise<T> {
    const { where, select, useCache } = params;

    const enhancedSelect = select ? this.ensurePrimaryKeys(select) : undefined;

    const pk = where[this.config.primaryKey];
    const result = await this.prismaTable.delete({
      where,
      select: enhancedSelect,
    });

    const shouldCache = useCache ?? this.shouldUseCache();
    if (shouldCache) {
      this.invalidateCache(pk);
    }

    return result as T;
  }
}
