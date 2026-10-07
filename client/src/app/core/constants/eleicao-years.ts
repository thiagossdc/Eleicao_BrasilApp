/**
 * Catálogo único de eleições suportadas pela aplicação (cruzamento, consulta
 * e sincronização). Evita anos divergentes entre as telas: tudo que aparece
 * aqui pode ser sincronizado via /api/sync e analisado nas demais áreas.
 */
export const ELEICAO_ANOS: readonly number[] = [2026, 2024, 2022, 2020, 2018, 2016];
