// js/seed.js：內建句子庫，內容逐字照規格 7.8；這個檔案不引入任何模組
// 陣列順序就是句子庫的顯示順序與新句的出場順序；text 已是 canonical 形式
/** @typedef {{ id: string, text: string, zh: string }} SeedItem */
/** @type {SeedItem[]} */
export const SEED = [
  // 引言（s01 到 s12）
  { id: 's01', text: 'In recent years, deep learning has been widely applied to many engineering problems.', zh: '近年來，深度學習已被廣泛應用於許多工程問題。' },
  { id: 's02', text: 'However, existing methods still suffer from high computational cost.', zh: '然而，現有方法仍有計算成本過高的問題。' },
  { id: 's03', text: 'To address this issue, we propose a simple yet effective method.', zh: '為了解決這個問題，我們提出一個簡單但有效的方法。' },
  { id: 's04', text: 'This problem has attracted increasing attention from both academia and industry.', zh: '這個問題受到學術界與產業界越來越多的關注。' },
  { id: 's05', text: 'To the best of our knowledge, this is the first work to study this problem.', zh: '據我們所知，這是第一個研究此問題的工作。' },
  { id: 's06', text: 'Despite these advances, several challenges remain to be addressed.', zh: '儘管已有這些進展，仍有幾項挑戰有待解決。' },
  { id: 's07', text: 'Most existing approaches rely on large amounts of labeled data.', zh: '大多數現有方法都依賴大量的標註資料。' },
  { id: 's08', text: 'In this paper, we focus on improving the efficiency of the inference process.', zh: '本文著重於提升推論過程的效率。' },
  { id: 's09', text: 'The proposed method achieves a better trade-off between accuracy and speed.', zh: '所提方法在準確度與速度之間取得更好的平衡。' },
  { id: 's10', text: 'Extensive experiments demonstrate the effectiveness of the proposed method.', zh: '大量實驗證明了所提方法的有效性。' },
  { id: 's11', text: 'The main contributions of this paper are summarized as follows.', zh: '本文的主要貢獻整理如下。' },
  { id: 's12', text: 'The rest of this paper is organized as follows.', zh: '本文其餘部分的架構如下。' },
  // 相關研究（s13 到 s18）
  { id: 's13', text: 'Many studies have been conducted to improve the performance of such systems.', zh: '已有許多研究致力於提升這類系統的效能。' },
  { id: 's14', text: 'Early work in this area mainly relied on handcrafted features.', zh: '此領域的早期研究主要依賴人工設計的特徵。' },
  { id: 's15', text: 'More recently, several methods have been proposed to address this limitation.', zh: '近來已有數種方法被提出，以解決這項限制。' },
  { id: 's16', text: 'Although these methods achieve promising results, they require considerable computational resources.', zh: '雖然這些方法有不錯的結果，但需要大量的計算資源。' },
  { id: 's17', text: 'Unlike previous studies, our method does not require any additional annotations.', zh: '與先前研究不同，我們的方法不需要任何額外的標註。' },
  { id: 's18', text: 'A detailed comparison with these methods is provided in Section 4.', zh: '與這些方法的詳細比較見第 4 節。' },
  // 方法（s19 到 s28）
  { id: 's19', text: 'The overall architecture of the proposed system is shown in Fig. 1.', zh: '所提系統的整體架構如圖 1 所示。' },
  { id: 's20', text: 'The proposed method consists of three main components.', zh: '所提方法由三個主要部分組成。' },
  { id: 's21', text: 'First, the input data are normalized to have zero mean and unit variance.', zh: '首先，將輸入資料正規化為平均值為零、變異數為一。' },
  { id: 's22', text: 'The details of each component are described in the following subsections.', zh: '各部分的細節將在以下小節說明。' },
  { id: 's23', text: 'We formulate this problem as a constrained optimization problem.', zh: '我們將此問題表述為一個有限制條件的最佳化問題。' },
  { id: 's24', text: 'The objective function is defined as the sum of two terms.', zh: '目標函數定義為兩項之和。' },
  { id: 's25', text: 'The parameters are updated iteratively until convergence.', zh: '參數以迭代方式更新，直到收斂為止。' },
  { id: 's26', text: 'To reduce the computational cost, we adopt a lightweight network architecture.', zh: '為了降低計算成本，我們採用輕量化的網路架構。' },
  { id: 's27', text: 'The pseudocode of the proposed algorithm is given in Algorithm 1.', zh: '所提演算法的虛擬碼列於演算法 1。' },
  { id: 's28', text: 'Note that this step does not require any prior knowledge of the system.', zh: '值得注意的是，此步驟不需要任何關於系統的先驗知識。' },
  // 實驗設定（s29 到 s35）
  { id: 's29', text: 'All experiments were conducted on the same hardware platform for a fair comparison.', zh: '為了公平比較，所有實驗都在相同的硬體平台上進行。' },
  { id: 's30', text: 'The dataset is randomly divided into training, validation, and test sets.', zh: '資料集被隨機分為訓練集、驗證集與測試集。' },
  { id: 's31', text: 'The hyperparameters were selected based on the performance on the validation set.', zh: '超參數依據驗證集上的效能來選擇。' },
  { id: 's32', text: 'We compare the proposed method with several state-of-the-art methods.', zh: '我們將所提方法與數個最先進的方法進行比較。' },
  { id: 's33', text: 'Each experiment was repeated five times, and the average results are reported.', zh: '每個實驗重複五次，並報告平均結果。' },
  { id: 's34', text: 'The performance is evaluated in terms of accuracy, precision, and recall.', zh: '效能以準確率、精確率與召回率來評估。' },
  { id: 's35', text: 'The implementation details are summarized in Table 1.', zh: '實作細節整理於表 1。' },
  // 結果（s36 到 s45）
  { id: 's36', text: 'As shown in Table 2, the proposed method outperforms all baseline methods.', zh: '如表 2 所示，所提方法優於所有基準方法。' },
  { id: 's37', text: 'The experimental results show that the proposed method achieves the best performance.', zh: '實驗結果顯示所提方法達到最佳效能。' },
  { id: 's38', text: 'Compared with the baseline, the proposed method reduces the error by a large margin.', zh: '與基準方法相比，所提方法大幅降低了誤差。' },
  { id: 's39', text: 'This improvement can be mainly attributed to the proposed module.', zh: '這項改進主要歸功於所提出的模組。' },
  { id: 's40', text: 'It can be observed that the performance decreases as the noise level increases.', zh: '可以觀察到，效能隨著雜訊程度增加而下降。' },
  { id: 's41', text: 'Fig. 3 illustrates the convergence behavior of the proposed algorithm.', zh: '圖 3 說明了所提演算法的收斂行為。' },
  { id: 's42', text: 'The results indicate that each component contributes to the overall performance.', zh: '結果顯示每個部分都對整體效能有所貢獻。' },
  { id: 's43', text: 'To further verify the effectiveness of each component, we conduct an ablation study.', zh: '為了進一步驗證各部分的有效性，我們進行消融實驗。' },
  { id: 's44', text: 'The proposed method is robust to variations in the input conditions.', zh: '所提方法對輸入條件的變化具有強健性。' },
  { id: 's45', text: 'These results are consistent with the findings of previous studies.', zh: '這些結果與先前研究的發現一致。' },
  // 討論與限制（s46 到 s51）
  { id: 's46', text: 'These findings suggest that the proposed method can be applied to other similar tasks.', zh: '這些發現顯示所提方法可應用於其他類似的任務。' },
  { id: 's47', text: 'One possible explanation is that the model overfits the training data.', zh: '一個可能的解釋是模型對訓練資料過度擬合。' },
  { id: 's48', text: 'However, the proposed method still has some limitations.', zh: '然而，所提方法仍有一些限制。' },
  { id: 's49', text: 'The performance may degrade when the training data are insufficient.', zh: '當訓練資料不足時，效能可能會下降。' },
  { id: 's50', text: 'This issue will be further investigated in future work.', zh: '這個問題將在未來的工作中進一步探討。' },
  { id: 's51', text: 'It should be noted that the computational cost increases with the size of the input.', zh: '值得注意的是，計算成本會隨輸入的大小而增加。' },
  // 結論與致謝（s52 到 s55）
  { id: 's52', text: 'In this paper, we proposed an efficient method to address this problem.', zh: '本文提出一種有效率的方法來解決此問題。' },
  { id: 's53', text: 'Future work will focus on extending the proposed method to real-world applications.', zh: '未來的工作將著重於把所提方法擴展到實際應用。' },
  { id: 's54', text: 'This work was supported in part by the National Science and Technology Council, Taiwan.', zh: '本研究部分經費由國科會補助。' },
  { id: 's55', text: 'The authors would like to thank the anonymous reviewers for their valuable comments.', zh: '作者感謝匿名審查委員提供的寶貴意見。' },
];
