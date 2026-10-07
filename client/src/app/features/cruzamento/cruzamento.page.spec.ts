import { AnalysisPoint, calculateStats, createBarChart, createQuintiles } from './cruzamento.page';

/** Monta um ponto municipal mínimo para as funções puras de análise. */
function ponto(percentualVotos: number, indicador: number, codigoIbge = '1'): AnalysisPoint {
  return {
    codigoIbge,
    municipio: `Município ${codigoIbge}`,
    uf: 'SP',
    votos: Math.round(percentualVotos),
    totalVotosNominais: 1000,
    percentualVotos,
    indicador,
    x: indicador,
  };
}

describe('calculateStats (correlação exibida na tela)', () => {
  it('retorna null com menos de três municípios', () => {
    expect(calculateStats([ponto(10, 1), ponto(20, 2)])).toBeNull();
  });

  it('retorna r = 1 para relação linear perfeita crescente', () => {
    const stats = calculateStats([ponto(10, 1), ponto(20, 2), ponto(30, 3), ponto(40, 4)]);
    expect(stats).not.toBeNull();
    expect(stats!.n).toBe(4);
    expect(stats!.r).toBeCloseTo(1, 10);
    expect(stats!.r2).toBeCloseTo(1, 10);
    expect(stats!.slope).toBeCloseTo(10, 10);
    expect(stats!.intercept).toBeCloseTo(0, 10);
    expect(stats!.p).toBeCloseTo(0, 10);
  });

  it('retorna r = -1 para relação linear perfeita decrescente', () => {
    const stats = calculateStats([ponto(40, 1), ponto(30, 2), ponto(20, 3), ponto(10, 4)]);
    expect(stats!.r).toBeCloseTo(-1, 10);
    expect(stats!.slope).toBeCloseTo(-10, 10);
  });

  it('retorna null quando não há variação (y ou x constante)', () => {
    expect(calculateStats([ponto(50, 1), ponto(50, 2), ponto(50, 3)])).toBeNull();
    expect(calculateStats([ponto(10, 7), ponto(20, 7), ponto(30, 7)])).toBeNull();
  });

  it('produz p-valor nominal entre 0 e 1 para correlação fraca', () => {
    const stats = calculateStats([
      ponto(10, 1), ponto(80, 2), ponto(30, 3),
      ponto(60, 4), ponto(20, 5), ponto(70, 6),
    ]);
    expect(stats).not.toBeNull();
    expect(stats!.r2).toBeLessThan(1);
    expect(stats!.p).toBeGreaterThan(0);
    expect(stats!.p).toBeLessThanOrEqual(1);
  });
});

describe('createQuintiles (faixas do indicador)', () => {
  it('retorna vazio com menos de cinco municípios', () => {
    expect(createQuintiles([ponto(1, 1), ponto(2, 2), ponto(3, 3), ponto(4, 4)])).toEqual([]);
  });

  it('divide dez municípios em cinco faixas ordenadas pelo indicador', () => {
    const pontos = [
      ponto(10, 5), ponto(20, 1), ponto(30, 9), ponto(40, 3), ponto(50, 7),
      ponto(60, 2), ponto(70, 8), ponto(80, 4), ponto(90, 6), ponto(95, 10),
    ];
    const faixas = createQuintiles(pontos);

    expect(faixas.length).toBe(5);
    expect(faixas.map((f) => f.count)).toEqual([2, 2, 2, 2, 2]);
    expect(faixas.reduce((total, f) => total + f.count, 0)).toBe(10);
    expect(faixas[0].label).toBe('Faixa 1');
    expect(faixas[0].position).toBe('Menores valores');
    expect(faixas[4].position).toBe('Maiores valores');
    // A faixa 1 corresponde aos dois menores valores do indicador (1 e 2).
    expect(faixas[0].range).toBe('1 a 2');
    // Média da faixa 1: municípios com indicador 1 (20%) e 2 (60%).
    expect(faixas[0].mean).toBeCloseTo(40, 10);
  });
});

describe('createBarChart (média de votos por faixa)', () => {
  it('retorna plano vazio sem pontos', () => {
    const plano = createBarChart([]);
    expect(plano.bars).toEqual([]);
    expect(plano.gridlines).toEqual([]);
  });

  it('gera uma barra por faixa, com linha de média geral e eixo Y coerente', () => {
    const pontos = Array.from({ length: 10 }, (_, index) => ponto(10 + index * 5, index + 1));
    const plano = createBarChart(pontos);

    expect(plano.bars.length).toBe(5);
    expect(plano.yMax).toBeGreaterThanOrEqual(Math.max(...plano.bars.map((bar) => bar.mean)));
    expect(plano.gridlines.length).toBe(5);
    expect(plano.overallMeanValue).toBeCloseTo(32.5, 6);
    // Linha da média geral fica dentro da área do gráfico.
    expect(plano.overallMeanY).toBeGreaterThan(16);
    expect(plano.overallMeanY).toBeLessThan(360);
    // Todas as barras têm geometria positiva dentro do gráfico.
    for (const bar of plano.bars) {
      expect(bar.ph).toBeGreaterThan(0);
      expect(bar.pTop).toBeGreaterThanOrEqual(16);
    }
  });
});
