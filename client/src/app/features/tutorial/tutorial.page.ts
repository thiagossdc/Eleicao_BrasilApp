import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

interface TutorialSection {
  id: string;
  title: string;
  lead: string;
  steps: string[];
  tip?: string;
}

@Component({
  selector: 'app-tutorial-page',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './tutorial.page.html',
  styleUrl: './tutorial.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TutorialPageComponent {
  readonly sections: TutorialSection[] = [
    {
      id: 'visao-geral',
      title: 'O que é esta aplicação',
      lead:
        'O Eleição Limpa - Brasil reúne dados eleitorais públicos do TSE e indicadores municipais do IBGE para consulta e análise, tudo processado localmente.',
      steps: [
        'A aplicação tem três áreas principais: Análises, Candidaturas e Atualizar dados, acessíveis pela barra superior.',
        'Os dados vêm exclusivamente de fontes oficiais: Portal de Dados Abertos do TSE e API de Agregados do IBGE.',
        'Nenhum arquivo precisa ser enviado pelo navegador: a sincronização e a leitura dos CSVs acontecem no servidor.',
        'Este é um projeto independente, sem vínculo institucional com o TSE ou o IBGE.',
      ],
      tip: 'Se é sua primeira vez, comece pela seção Candidaturas e depois explore as Análises.',
    },
    {
      id: 'candidaturas',
      title: 'Consulta de candidaturas',
      lead:
        'Pesquise candidatos por nome, UF, ano, cargo e partido, e abra um registro para ver os motivos de cassação vinculados.',
      steps: [
        'Acesse "Candidaturas" na barra superior.',
        'Preencha os filtros: nome ou nome de urna, UF, ano da eleição, cargo e partido. Todos são opcionais.',
        'Marque "Somente com alerta de risco" para listar apenas candidatos com registros de cassação vinculados.',
        'Clique em "Buscar" para listar os resultados. O total de registros encontrados aparece acima da lista.',
        'Clique em um resultado para abrir o detalhe do candidato e os processos/motivos de cassação, quando existirem.',
        'Se a base estiver vazia, vá até "Atualizar dados" para importar os arquivos oficiais do TSE.',
      ],
      tip: 'Os dropdowns de cargo e partido são preenchidos a partir do conteúdo já importado — quanto mais dados sincronizados, mais opções.',
    },
    {
      id: 'analises',
      title: 'Análises (cruzamento TSE × IBGE)',
      lead:
        'Cruze a votação municipal do TSE com indicadores do IBGE (demografia, economia, educação e infraestrutura) em gráficos comparáveis.',
      steps: [
        'Acesse "Análises" na barra superior (página inicial).',
        'Escolha o ano da eleição, a UF (ou BRASIL para o arquivo nacional), o cargo e o turno.',
        'Busque um candidato específico, ou use o modo por partido para agregar votos de todas as candidaturas da sigla.',
        'Escolha o indicador: população, densidade, PIB, alfabetização, rede de esgoto etc.',
        'Explore o resultado: dispersão municipal, agrupamento por quintis e mapa com a malha oficial do IBGE.',
        'Se disponível, use o tira-dúvidas para dúvidas sobre a aplicação, fontes e metodologia.',
      ],
      tip: 'As correlações exibidas são exploratorias e bivariadas: indicam associação, não causalidade.',
    },
    {
      id: 'atualizar-dados',
      title: 'Atualizar dados do TSE',
      lead:
        'A tela "Atualizar dados" baixa os ZIPs oficiais, extrai o CSV da UF escolhida e grava no banco local SQLite.',
      steps: [
        'Acesse "Atualizar dados" na barra superior.',
        'Escolha o ano da eleição e a UF desejada (ou BRASIL para o arquivo nacional).',
        'Clique em "Iniciar importação" e aguarde: o servidor baixa e processa candidatos e motivos de cassação.',
        'Ao final, a tela mostra quantos candidatos e registros de cassação foram processados.',
        'Repita o processo para cada UF/ano que desejar consultar nas telas de consulta e análise.',
      ],
      tip: 'O arquivo nacional BRASIL é muito grande e pode demorar. Se a importação falhar por tempo limite, tente uma UF ou tente mais tarde.',
    },
    {
      id: 'dicas',
      title: 'Dicas e boa prática',
      lead: 'Alguns hábitos que ajudam a interpretar melhor os dados e a usar a aplicação com segurança.',
      steps: [
        'Sempre que possível, confirme o dado citado na fonte oficial — os links das fontes ficam em cada análise.',
        'Siga o rodapé e os textos de metodologia: percentuais, agregações e limitações estão explicados ali.',
        'Use filtros combinados na consulta (ex.: UF + ano + cargo) para reduzir o resultado e encontrar mais rápido.',
        'Em caso de dúvida sobre siglas de partidos, o dropdown mostra "sigla · nome completo".',
        'Este manual fica disponível a qualquer momento na aba "Tutorial" da barra superior.',
      ],
      tip: 'O aviso de boas-vindas com atalho para este manual aparece apenas na primeira visita.',
    },
  ];
}
