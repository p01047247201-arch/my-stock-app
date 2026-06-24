import React, { useState, useEffect, useMemo } from 'react';
import { Plus, TrendingUp, TrendingDown, Trash2, DollarSign, Briefcase, Activity, LayoutDashboard, Wallet, PieChart, RefreshCcw, Landmark, Coins, Search, X, LogOut } from 'lucide-react';
import { initializeApp } from "firebase/app";
import { getFirestore, collection, onSnapshot, doc, setDoc, deleteDoc, updateDoc } from 'firebase/firestore';
import { getAuth, signInWithCustomToken, signInAnonymously, signOut, onAuthStateChanged } from "firebase/auth";

// 1. Firebase 초기화 (캔버스 환경 변수 우선 적용, 없을 시 유저의 설정값 폴백)
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

export default function App() {
  const [exchangeRate, setExchangeRate] = useState(1350.50);
  const [isRefreshingFx, setIsRefreshingFx] = useState(false);
  const [isRefreshingPrices, setIsRefreshingPrices] = useState(false);
  const [fxLastUpdated, setFxLastUpdated] = useState('');
  const [activeTab, setActiveTab] = useState('dashboard');
  const [accounts, setAccounts] = useState([]);

  // 인증 상태 관리
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, message: '', onConfirm: null });

  // 모달 및 폼 상태
  const [selectedAccountId, setSelectedAccountId] = useState(null);
  const [isAddAccountModalOpen, setIsAddAccountModalOpen] = useState(false);
  const [newAccountForm, setNewAccountForm] = useState({ name: '', accountNumber: '', startDate: new Date().toISOString().split('T')[0] });
  const [isEditCashModalOpen, setIsEditCashModalOpen] = useState(false);
  const [cashEditForm, setCashEditForm] = useState({ cashKRW: 0, cashUSD: 0 });
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isDividendModalOpen, setIsDividendModalOpen] = useState(false);
  const [isAddStockModalOpen, setIsAddStockModalOpen] = useState(false);
  const [newStockForm, setNewStockForm] = useState({ ticker: '', name: '', currentPrice: '', currency: 'KRW' });
  const [isSearchingTicker, setIsSearchingTicker] = useState(false);
  const [searchMessage, setSearchMessage] = useState(null);
  const [isStockManageModalOpen, setIsStockManageModalOpen] = useState(false);
  const [managingStockId, setManagingStockId] = useState(null);
  const [manageTab, setManageTab] = useState('history'); 
  const [txForm, setTxForm] = useState({ type: 'buy', date: new Date().toISOString().split('T')[0], price: '', quantity: '' });
  const [divForm, setDivForm] = useState({ date: new Date().toISOString().split('T')[0], amount: '', currency: 'KRW' });
  const [historyFilter, setHistoryFilter] = useState({ startDate: '', endDate: '', ticker: '' });
  const [dividendFilter, setDividendFilter] = useState({ startDate: '', endDate: '', ticker: '' });

  // 표 정렬을 위한 상태
  const [sortConfig, setSortConfig] = useState({ key: 'weight', direction: 'desc' });

  const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#64748b'];

  // [수정점 1] 팝업 이슈를 피하기 위한 자동 로그인 처리 (Custom Token or Anonymously)
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        setAuthError("인증 초기화 실패: " + err.message);
      }
    };
    
    initAuth();

    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });
    return () => unsubscribeAuth();
  }, []);

  const handleLogout = () => {
    setConfirmDialog({
      isOpen: true,
      message: "로그아웃 하시겠습니까?",
      onConfirm: async () => {
        await signOut(auth);
        setConfirmDialog({ isOpen: false, message: '', onConfirm: null });
      }
    });
  };

  // [수정점 2] Firestore 데이터 동기화 시 올바른 경로 지정
  useEffect(() => {
    if (!user) {
      setAccounts([]);
      return;
    }
    
    const accountsRef = collection(db, 'artifacts', appId, 'users', user.uid, 'accounts');
    
    const unsubscribe = onSnapshot(accountsRef, (snapshot) => {
      const loadedAccounts = snapshot.docs.map(doc => doc.data());
      loadedAccounts.sort((a, b) => a.id - b.id);
      setAccounts(loadedAccounts);
      if (loadedAccounts.length > 0) {
        setSelectedAccountId(prevId => {
          const stillExists = loadedAccounts.find(a => a.id === prevId);
          return stillExists ? prevId : loadedAccounts[0].id;
        });
      } else {
        setSelectedAccountId(null);
      }
    }, (error) => {
        console.error("Firestore Error: ", error);
        setAuthError("데이터를 불러오는데 실패했습니다. 권한을 확인해주세요.");
    });
    return () => unsubscribe();
  }, [user]);

  // [수정점 3] 성능 최적화: 무거운 계산은 useMemo를 사용하여 캐싱 처리
  const accountStats = useMemo(() => {
    const getValKRW = (val, currency) => currency === 'USD' ? val * exchangeRate : val;

    return accounts.map(acc => {
      const stockInvested = acc.stocks.reduce((sum, s) => sum + getValKRW(s.avgPrice * s.quantity, s.currency), 0);
      const stockCurrent = acc.stocks.reduce((sum, s) => sum + getValKRW(s.currentPrice * s.quantity, s.currency), 0);
      
      const totalCashValue = acc.cashKRW + getValKRW(acc.cashUSD, 'USD');
      const totalCurrentValue = stockCurrent + totalCashValue;
      const principal = stockInvested + totalCashValue;
      
      const profit = stockCurrent - stockInvested;
      const yieldPercent = principal > 0 ? (profit / principal) * 100 : 0;
      
      const today = new Date();
      const start = new Date(acc.startDate);
      const durationYears = Math.abs(today - start) / (1000 * 60 * 60 * 24 * 365.25);
      const years = Math.floor(durationYears);
      const months = Math.floor((durationYears - years) * 12);
      const durationString = years > 0 ? `${years}년 ${months}개월` : `${months}개월`;
      
      let cagr = 0;
      if (principal > 0 && durationYears > 0) cagr = (Math.pow((totalCurrentValue / principal), (1 / durationYears)) - 1) * 100;
      if (durationYears < 1) cagr = yieldPercent;
      
      const portfolioItems = [
        ...acc.stocks.map(s => ({ name: s.name, ticker: s.ticker, value: getValKRW(s.currentPrice * s.quantity, s.currency), currentPrice: s.currentPrice, currency: s.currency, isCash: false })),
        { name: '원화 예수금', ticker: 'KRW_CASH', value: acc.cashKRW, isCash: true, currency: 'KRW' },
        { name: '달러 예수금', ticker: 'USD_CASH', value: getValKRW(acc.cashUSD, 'USD'), isCash: true, currency: 'USD' }
      ].filter(item => item.value > 0).sort((a, b) => b.value - a.value);
      
      const totalDividend = acc.dividends.reduce((sum, d) => sum + getValKRW(d.amount, d.currency), 0);
      const targetWeights = acc.targetWeights || {};

      return { ...acc, stockInvested, stockCurrent, totalCurrentValue, principal, profit, yieldPercent, durationString, cagr, portfolioItems, totalDividend, targetWeights };
    });
  }, [accounts, exchangeRate]);

  // 대시보드 요약용 Data Memoization
  const { 
    globalTotalAssets, globalPrincipal, globalStockInvested, 
    globalStockCurrent, globalTotalProfit, globalYieldPercent, globalTotalDividend 
  } = useMemo(() => {
    const totalAssets = accountStats.reduce((sum, acc) => sum + acc.totalCurrentValue, 0);
    const principal = accountStats.reduce((sum, acc) => sum + acc.principal, 0);
    const stockInvested = accountStats.reduce((sum, acc) => sum + acc.stockInvested, 0);
    const stockCurrent = accountStats.reduce((sum, acc) => sum + acc.stockCurrent, 0);
    const profit = totalAssets - principal;
    const yieldPct = principal > 0 ? (profit / principal) * 100 : 0;
    const dividends = accountStats.reduce((sum, acc) => sum + acc.totalDividend, 0);

    return {
        globalTotalAssets: totalAssets,
        globalPrincipal: principal,
        globalStockInvested: stockInvested,
        globalStockCurrent: stockCurrent,
        globalTotalProfit: profit,
        globalYieldPercent: yieldPct,
        globalTotalDividend: dividends
    };
  }, [accountStats]);

  const fetchRealExchangeRate = async () => {
    setIsRefreshingFx(true);
    let fetchedRate = null;
    try {
      const res = await fetch("https://script.google.com/macros/s/AKfycbzROt6Leim7zljq_as2YDqsNhr9DgY482dkMTvTZEsrdKz88x7Y3GDr-rhwoYTrE68F/exec?ticker=FX_USD");
      if (res.ok) {
        const data = await res.json();
        const stockData = Array.isArray(data) ? data[0] : data;
        if (stockData && !stockData.error) {
          const rawPrice = stockData.price !== undefined ? stockData.price : Object.values(stockData)[1];
          if (rawPrice) fetchedRate = parseFloat(String(rawPrice).replace(/[^0-9.-]/g, ''));
        }
      }
    } catch (e) {
      console.log("환율 스크립트 연결 실패, 대체 API를 시도합니다.");
    }
    
    if (!fetchedRate || isNaN(fetchedRate) || fetchedRate <= 0) {
      try {
        const fallbackRes = await fetch('https://open.er-api.com/v6/latest/USD');
        const fallbackData = await fallbackRes.json();
        if (fallbackData && fallbackData.rates && fallbackData.rates.KRW) fetchedRate = fallbackData.rates.KRW;
      } catch (e) {}
    }
    
    if (fetchedRate && !isNaN(fetchedRate) && fetchedRate > 0) {
      setExchangeRate(fetchedRate);
      const now = new Date();
      setFxLastUpdated(`${now.getMonth() + 1}/${now.getDate()} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`);
    }
    setIsRefreshingFx(false);
  };

  const refreshAllStockPrices = async () => {
    if(!user || accounts.length === 0) return;
    setIsRefreshingPrices(true);
    
    const priceMap = {};
    const allTickers = new Set();
    accounts.forEach(acc => acc.stocks.forEach(s => allTickers.add(s.ticker)));

    for(const ticker of allTickers) {
       try {
          const res = await fetch(`https://script.google.com/macros/s/AKfycbzROt6Leim7zljq_as2YDqsNhr9DgY482dkMTvTZEsrdKz88x7Y3GDr-rhwoYTrE68F/exec?ticker=${ticker}`);
          if(res.ok) {
             const data = await res.json();
             const stockData = Array.isArray(data) ? data[0] : data;
             const rawPrice = stockData.price !== undefined ? stockData.price : Object.values(stockData)[1];
             if (rawPrice !== undefined && rawPrice !== null && rawPrice !== '') {
                priceMap[ticker] = parseFloat(String(rawPrice).replace(/[^0-9.-]/g, ''));
             }
          }
       } catch(e) {
          console.error("가격 업데이트 실패:", ticker);
       }
    }

    for(const acc of accounts) {
       let changed = false;
       const newStocks = acc.stocks.map(s => {
          if(priceMap[s.ticker] !== undefined && priceMap[s.ticker] !== s.currentPrice) {
             changed = true;
             return { ...s, currentPrice: priceMap[s.ticker] };
          }
          return s;
       });
       if(changed) {
          await updateDoc(doc(db, "artifacts", appId, "users", user.uid, "accounts", acc.id.toString()), { stocks: newStocks });
       }
    }
    
    setIsRefreshingPrices(false);
  };

  const handleRefreshAll = async () => {
    await fetchRealExchangeRate();
    await refreshAllStockPrices();
    setConfirmDialog({ isOpen: true, message: "환율 및 모든 종목의 현재가 정보가 실시간으로 최신화되었습니다.", onConfirm: () => setConfirmDialog({ isOpen: false }) });
  };
  
  useEffect(() => { fetchRealExchangeRate(); }, []);

  const generateConicGradient = (items, totalValue) => {
    if (totalValue === 0) return 'conic-gradient(#e2e8f0 0% 100%)';
    let currentAngle = 0;
    const stops = items.map((item, index) => {
      const percentage = (item.value / totalValue) * 100;
      const start = currentAngle; currentAngle += percentage;
      return `${CHART_COLORS[index % CHART_COLORS.length]} ${start}% ${currentAngle}%`;
    });
    return `conic-gradient(${stops.join(', ')})`;
  };

  const requestSort = (key) => {
    let direction = 'desc';
    if (sortConfig.key === key && sortConfig.direction === 'desc') {
      direction = 'asc';
    }
    setSortConfig({ key, direction });
  };

  const SortIcon = ({ columnKey }) => {
    if (sortConfig.key !== columnKey) return <span className="text-gray-300 ml-1 text-[10px]">↕</span>;
    return <span className="text-blue-600 ml-1 text-xs">{sortConfig.direction === 'asc' ? '▲' : '▼'}</span>;
  };

  // 4. 데이터 조작 (Firebase 연동 경로 수정)
  const handleAddAccount = async (e) => {
    e.preventDefault();
    if (!newAccountForm.name.trim() || !user) return;
    const newId = Date.now();
    const newAcc = { 
      id: newId, 
      name: newAccountForm.name, 
      accountNumber: newAccountForm.accountNumber || '계좌번호 없음', 
      startDate: newAccountForm.startDate || new Date().toISOString().split('T')[0], 
      cashKRW: 0, 
      cashUSD: 0, 
      stocks: [], 
      history: [], 
      dividends: [],
      targetWeights: {}
    };
    await setDoc(doc(db, "artifacts", appId, "users", user.uid, "accounts", newId.toString()), newAcc);
    setSelectedAccountId(newId);
    setIsAddAccountModalOpen(false);
    setNewAccountForm({ name: '', accountNumber: '', startDate: new Date().toISOString().split('T')[0] });
  };

  const deleteAccount = (accountId) => {
    setConfirmDialog({
      isOpen: true,
      message: "정말 이 계좌를 삭제하시겠습니까?",
      onConfirm: async () => {
        if (user) {
          await deleteDoc(doc(db, "artifacts", appId, "users", user.uid, "accounts", accountId.toString()));
        }
        setConfirmDialog({ isOpen: false, message: '', onConfirm: null });
      }
    });
  };

  const deleteStockFromAccount = (accountId, stockId) => {
    setConfirmDialog({
      isOpen: true,
      message: "정말 이 종목을 삭제하시겠습니까?",
      onConfirm: async () => {
        if (user) {
          const acc = accounts.find(a => a.id === accountId);
          await updateDoc(doc(db, "artifacts", appId, "users", user.uid, "accounts", accountId.toString()), { 
            stocks: acc.stocks.filter(s => s.id !== stockId) 
          });
        }
        setConfirmDialog({ isOpen: false, message: '', onConfirm: null });
      }
    });
  };

  const handleDeleteHistory = (accountId, recordId) => {
    setConfirmDialog({
      isOpen: true,
      message: "이 거래 내역을 삭제하시겠습니까?\n(예수금 및 보유 수량은 자동으로 취소되지 않으므로 직접 수정해야 합니다.)",
      onConfirm: async () => {
        const acc = accounts.find(a => a.id === accountId);
        const newHistory = acc.history.filter(h => h.id !== recordId);
        await updateDoc(doc(db, "artifacts", appId, "users", user.uid, "accounts", accountId.toString()), { history: newHistory });
        setConfirmDialog({ isOpen: false, message: '', onConfirm: null });
      }
    });
  };

  const handleDeleteDividend = (accountId, recordId) => {
    setConfirmDialog({
      isOpen: true,
      message: "이 배당금 입금 내역을 삭제하시겠습니까?\n(예수금은 자동으로 취소되지 않으므로 직접 수정해야 합니다.)",
      onConfirm: async () => {
        const acc = accounts.find(a => a.id === accountId);
        const newDividends = acc.dividends.filter(d => d.id !== recordId);
        await updateDoc(doc(db, "artifacts", appId, "users", user.uid, "accounts", accountId.toString()), { dividends: newDividends });
        setConfirmDialog({ isOpen: false, message: '', onConfirm: null });
      }
    });
  };

  const handleEditCash = async (e) => {
    e.preventDefault();
    if (!user) return;
    await updateDoc(doc(db, "artifacts", appId, "users", user.uid, "accounts", selectedAccountId.toString()), { 
      cashKRW: Number(cashEditForm.cashKRW), 
      cashUSD: Number(cashEditForm.cashUSD) 
    });
    setIsEditCashModalOpen(false);
  };

  const handleAddStock = async (e) => {
    e.preventDefault();
    if (!newStockForm.ticker || !newStockForm.name || !user) return;
    const newStock = { 
      id: Date.now(), 
      ticker: newStockForm.ticker.toUpperCase(), 
      name: newStockForm.name, 
      avgPrice: 0, 
      currentPrice: parseFloat(newStockForm.currentPrice), 
      quantity: 0, 
      currency: newStockForm.currency 
    };
    const acc = accounts.find(a => a.id === selectedAccountId);
    await updateDoc(doc(db, "artifacts", appId, "users", user.uid, "accounts", selectedAccountId.toString()), { 
      stocks: [...acc.stocks, newStock] 
    });
    setIsAddStockModalOpen(false);
    setNewStockForm({ ticker: '', name: '', currentPrice: '', currency: 'KRW' });
    setSearchMessage(null);
  };

  const fetchStockInfoFromAPI = async () => {
    const searchTicker = newStockForm.ticker.trim().toUpperCase();
    if (!searchTicker) return;
    setIsSearchingTicker(true); 
    setSearchMessage(null);
    try {
      const response = await fetch(`https://script.google.com/macros/s/AKfycbzROt6Leim7zljq_as2YDqsNhr9DgY482dkMTvTZEsrdKz88x7Y3GDr-rhwoYTrE68F/exec?ticker=${searchTicker}`);
      if (!response.ok) throw new Error('API 에러');
      let data = await response.json();
      const stockData = Array.isArray(data) ? data[0] : data;
      const rawPrice = stockData.price !== undefined ? stockData.price : Object.values(stockData)[1];
      const rawName = stockData.name !== undefined ? stockData.name : Object.values(stockData)[2];
      
      if (rawPrice !== undefined && rawPrice !== null && rawPrice !== '') {
        const priceVal = parseFloat(String(rawPrice).replace(/[^0-9.-]/g, ''));
        const fetchedName = rawName || searchTicker;
        setNewStockForm(prev => ({ ...prev, name: fetchedName, currentPrice: priceVal || prev.currentPrice }));
        setSearchMessage({ type: 'success', text: `'${fetchedName}' 정보를 성공적으로 불러왔습니다.` });
      } else {
        setSearchMessage({ type: 'error', text: '정보를 찾을 수 없습니다.' });
      }
    } catch (error) {
      setSearchMessage({ type: 'error', text: '데이터를 가져오는 중 문제가 발생했습니다.' });
    } finally {
      setIsSearchingTicker(false);
    }
  };

  const handleAddTransaction = async (e) => {
    e.preventDefault();
    const qty = parseFloat(txForm.quantity); 
    const price = parseFloat(txForm.price);
    if(qty <= 0 || price < 0 || !user) return;
    
    const acc = accounts.find(a => a.id === selectedAccountId);
    if (!acc) return;
    const targetStock = acc.stocks.find(s => s.id === managingStockId);
    if (!targetStock) return;
    
    const isUSD = targetStock.currency === 'USD'; 
    const isBuy = txForm.type === 'buy'; 
    const totalAmount = price * qty;
    
    let newQty = targetStock.quantity; 
    let newAvgPrice = targetStock.avgPrice;
    
    if (isBuy) { 
      const currentTotal = newQty * newAvgPrice; 
      newQty += qty; 
      newAvgPrice = (currentTotal + totalAmount) / newQty; 
    } else { 
      newQty -= qty; 
    }
    
    const updatedStocks = acc.stocks.map(s => s.id === managingStockId ? { ...s, quantity: newQty, avgPrice: newAvgPrice } : s);
    let newCashKRW = acc.cashKRW; 
    let newCashUSD = acc.cashUSD;
    
    if (isUSD) newCashUSD += (isBuy ? -totalAmount : totalAmount); 
    else newCashKRW += (isBuy ? -totalAmount : totalAmount);
    
    const newRecord = { 
      id: Date.now(), 
      date: txForm.date, 
      type: txForm.type, 
      ticker: targetStock.ticker, 
      name: targetStock.name, 
      price: price, 
      quantity: qty, 
      currency: targetStock.currency, 
      avgBuyPrice: isBuy ? null : targetStock.avgPrice 
    };
    
    await updateDoc(doc(db, "artifacts", appId, "users", user.uid, "accounts", selectedAccountId.toString()), { 
      stocks: updatedStocks, 
      cashKRW: newCashKRW, 
      cashUSD: newCashUSD, 
      history: [...acc.history, newRecord] 
    });
    
    setTxForm({ type: 'buy', date: new Date().toISOString().split('T')[0], price: '', quantity: '' });
    setIsStockManageModalOpen(false);
  };

  const handleAddDividend = async (e) => {
    e.preventDefault();
    const amount = parseFloat(divForm.amount);
    if(amount <= 0 || !user) return;
    
    const acc = accounts.find(a => a.id === selectedAccountId);
    if (!acc) return;
    const targetStock = acc.stocks.find(s => s.id === managingStockId);
    if (!targetStock) return;
    
    const isUSD = divForm.currency === 'USD'; 
    let newCashKRW = acc.cashKRW; 
    let newCashUSD = acc.cashUSD;
    
    if (isUSD) newCashUSD += amount; 
    else newCashKRW += amount;
    
    const newRecord = { 
      id: Date.now(), 
      date: divForm.date, 
      ticker: targetStock.ticker, 
      name: targetStock.name, 
      amount: amount, 
      currency: divForm.currency 
    };
    
    await updateDoc(doc(db, "artifacts", appId, "users", user.uid, "accounts", selectedAccountId.toString()), { 
      cashKRW: newCashKRW, 
      cashUSD: newCashUSD, 
      dividends: [...acc.dividends, newRecord] 
    });
    
    setDivForm({ date: new Date().toISOString().split('T')[0], amount: '', currency: 'KRW' });
    setIsStockManageModalOpen(false);
  };

  const handleTargetWeightChange = async (accountId, ticker, value) => {
    const acc = accounts.find(a => a.id === accountId);
    const newWeights = { ...(acc.targetWeights || {}), [ticker]: Number(value) };
    
    await updateDoc(doc(db, "artifacts", appId, "users", user.uid, "accounts", accountId.toString()), { 
      targetWeights: newWeights 
    });
  };

  // -------------------------------------------------------------
  // 5. 렌더링 UI 
  // -------------------------------------------------------------

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center font-sans">
        <RefreshCcw className="w-8 h-8 text-blue-600 animate-spin mb-4" />
        <p className="text-gray-500 text-sm font-medium">보안 서버와 안전하게 연결 중입니다...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4 font-sans">
        <div className="bg-white p-10 rounded-3xl shadow-lg border border-gray-100 max-w-sm w-full text-center animate-in fade-in zoom-in duration-500">
          <div className="bg-blue-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
            <Activity className="w-10 h-10 text-blue-600" />
          </div>
          <h1 className="text-3xl font-extrabold text-gray-900 mb-3 tracking-tight">내 주식 매니저</h1>
          <p className="text-gray-500 text-sm mb-6 leading-relaxed">
            세상에서 가장 안전한 나만의 자산 관리.<br/>
            구글 계정으로 로그인 후 이용해 주세요.
          </p>
          
          {authError && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-600 text-xs text-left animate-in fade-in overflow-hidden break-words">
              <p className="font-bold mb-2">💡 확인이 필요합니다</p>
              <p className="whitespace-pre-wrap leading-relaxed select-all">{authError}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-800 font-sans pb-12">
      <header className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-20 transition-all">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Activity className="w-6 h-6 sm:w-7 sm:h-7 text-blue-600" />
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">내 주식 매니저</h1>
          </div>
          <div className="flex items-center gap-4 sm:gap-6">
            <div className="flex items-center gap-2 bg-slate-100 pl-2 pr-3 py-1.5 rounded-full border border-slate-200 shadow-inner">
              {user.photoURL ? (
                <img src={user.photoURL} alt="profile" className="w-6 h-6 sm:w-7 sm:h-7 rounded-full border border-white shadow-sm" />
              ) : (
                <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-gray-300 border border-white shadow-sm"></div>
              )}
              <span className="text-xs sm:text-sm font-semibold text-gray-700 hidden sm:inline">{user.displayName || '게스트'}님</span>
              <button onClick={handleLogout} className="text-gray-400 hover:text-red-500 transition-colors ml-1 p-1 hover:bg-red-50 rounded-full" title="로그아웃">
                <LogOut className="w-4 h-4" />
              </button>
            </div>
            
            <div className="flex flex-col items-end shrink-0">
              <div className="flex items-center gap-2 sm:gap-3 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200 shadow-sm transition-all hover:border-blue-200">
                <span className="text-[10px] sm:text-xs font-semibold text-slate-500 uppercase hidden sm:inline">USD/KRW</span>
                <span className="text-sm sm:text-base font-bold text-slate-800 tracking-tight">
                  {exchangeRate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <button 
                  onClick={handleRefreshAll} 
                  className={`p-1 text-slate-400 hover:text-blue-600 bg-white rounded-md border shadow-sm transition-all ${(isRefreshingFx || isRefreshingPrices) ? 'animate-spin border-blue-200 text-blue-600' : 'hover:border-blue-200'}`} 
                  title="환율 및 현재가 즉시 업데이트"
                >
                  <RefreshCcw className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                </button>
              </div>
              {fxLastUpdated && (
                <span className="text-[9px] sm:text-[10px] text-gray-400 mt-1 mr-1 font-medium tracking-tight truncate">
                  {fxLastUpdated} 업데이트
                </span>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="bg-white border-b border-gray-200 sticky top-16 z-10 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 flex gap-2 sm:gap-8 overflow-x-auto hide-scrollbar touch-pan-x">
          <button onClick={() => setActiveTab('dashboard')} className={`py-3 sm:py-4 px-2 sm:px-1 text-xs sm:text-sm font-bold border-b-2 transition-all duration-200 flex items-center gap-1.5 sm:gap-2 whitespace-nowrap ${activeTab === 'dashboard' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-700'}`}>
            <LayoutDashboard className="w-4 h-4 sm:w-5 sm:h-5" /> 대시보드
          </button>
          <button onClick={() => setActiveTab('accounts')} className={`py-3 sm:py-4 px-2 sm:px-1 text-xs sm:text-sm font-bold border-b-2 transition-all duration-200 flex items-center gap-1.5 sm:gap-2 whitespace-nowrap ${activeTab === 'accounts' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-700'}`}>
            <Wallet className="w-4 h-4 sm:w-5 sm:h-5" /> 계좌 관리
          </button>
          <button onClick={() => setActiveTab('rebalancing')} className={`py-3 sm:py-4 px-2 sm:px-1 text-xs sm:text-sm font-bold border-b-2 transition-all duration-200 flex items-center gap-1.5 sm:gap-2 whitespace-nowrap ${activeTab === 'rebalancing' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-700'}`}>
            <PieChart className="w-4 h-4 sm:w-5 sm:h-5" /> 리밸런싱
          </button>
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        
        {/* 탭 1: 대시보드 화면 */}
        {activeTab === 'dashboard' && (
          <div className="space-y-6 sm:space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <section className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5 sm:p-8 hover:shadow-md transition-shadow">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12">
                <div className="flex flex-col justify-center">
                  
                  {/* 모든 계좌 총 자산 헤더 */}
                  <div className="flex items-center gap-2 mb-2 mt-1">
                    <Briefcase className="w-4 h-4 text-gray-400" />
                    <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider">모든 계좌 총 자산</h2>
                  </div>
                  
                  {/* 총 자산, 손익(수익률) 2줄 표기 */}
                  <div className="flex flex-col items-start gap-1 mb-8">
                    <div className="flex items-baseline gap-2">
                      <p className="text-4xl sm:text-5xl font-extrabold text-gray-900 tracking-tight">
                        {Math.round(globalTotalAssets).toLocaleString()}
                      </p>
                      <span className="text-2xl sm:text-3xl font-bold text-gray-500">원</span>
                    </div>
                    
                    <div className={`inline-flex items-center text-lg sm:text-xl font-bold px-3 py-1.5 rounded-lg ${globalTotalProfit >= 0 ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'}`}>
                      {globalTotalProfit > 0 ? '▲' : (globalTotalProfit < 0 ? '▼' : '')} {Math.round(Math.abs(globalTotalProfit)).toLocaleString()}원 
                      <span className="ml-1.5 text-sm sm:text-base opacity-80">({globalTotalProfit > 0 ? '+' : ''}{globalYieldPercent.toFixed(2)}%)</span>
                    </div>
                  </div>
                  
                  {/* 4줄 세로 배열 리스트 형태 */}
                  <div className="flex flex-col gap-3 w-full">
                    <div className="bg-blue-50/50 rounded-2xl p-4 border border-blue-50 hover:bg-blue-100/50 transition-colors flex justify-between items-center">
                      <p className="text-sm font-bold text-blue-600 flex items-center gap-2 whitespace-nowrap"><TrendingUp className="w-4 h-4" /> 총 매수금액</p>
                      <p className="text-base font-extrabold text-blue-800 truncate">{Math.round(globalStockInvested).toLocaleString()}원</p>
                    </div>
                    <div className="bg-gray-50/80 rounded-2xl p-4 border border-gray-100 hover:bg-gray-100 transition-colors flex justify-between items-center">
                      <p className="text-sm font-bold text-gray-600 flex items-center gap-2 whitespace-nowrap"><Briefcase className="w-4 h-4 text-emerald-500" /> 총 평가금액</p>
                      <p className="text-base font-extrabold text-gray-900 truncate">{Math.round(globalStockCurrent).toLocaleString()}원</p>
                    </div>
                    <div className="bg-red-50/50 rounded-2xl p-4 border border-red-50 hover:bg-red-100/50 transition-colors flex justify-between items-center">
                      <p className="text-sm font-bold text-red-500 flex items-center gap-2 whitespace-nowrap"><Coins className="w-4 h-4 text-red-500" /> 총 누적 배당금</p>
                      <p className="text-base font-extrabold text-red-600 truncate">+{Math.round(globalTotalDividend).toLocaleString()}원</p>
                    </div>
                    <div className="bg-purple-50/50 rounded-2xl p-4 border border-purple-50 hover:bg-purple-100/50 transition-colors flex justify-between items-center">
                      <p className="text-sm font-bold text-purple-600 flex items-center gap-2 whitespace-nowrap"><Wallet className="w-4 h-4 text-purple-500" /> 보유 계좌 수</p>
                      <p className="text-base font-extrabold text-purple-900 truncate">{accounts.length}개</p>
                    </div>
                  </div>
                </div>
                
                <div className="flex flex-col justify-center bg-slate-50 p-6 rounded-3xl border border-slate-100 mt-4 lg:mt-0">
                  <h3 className="text-sm font-bold text-gray-700 mb-5 flex items-center gap-2"><PieChart className="w-4 h-4 text-gray-400" />계좌별 자산 비중</h3>
                  <div className="w-full h-5 rounded-full overflow-hidden flex mb-6 bg-gray-200 shadow-inner">
                    {accountStats.map((acc, index) => {
                      const weight = globalTotalAssets > 0 ? (acc.totalCurrentValue / globalTotalAssets) * 100 : 0;
                      return <div key={acc.id} style={{ width: `${weight}%`, backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }} className="h-full transition-all duration-1000 ease-out hover:opacity-80" title={`${acc.name}: ${weight.toFixed(1)}%`} />;
                    })}
                  </div>
                  <div className="space-y-3">
                    {accountStats.map((acc, index) => {
                      const weight = globalTotalAssets > 0 ? (acc.totalCurrentValue / globalTotalAssets) * 100 : 0;
                      return (
                        <div key={acc.id} className="flex items-center justify-between text-sm group">
                          <div className="flex items-center gap-3">
                            <span className="w-3.5 h-3.5 rounded-full shadow-sm" style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}></span>
                            <span className="font-semibold text-gray-700 group-hover:text-gray-900 transition-colors truncate max-w-[150px] sm:max-w-[200px]">{acc.name}</span>
                          </div>
                          <div className="flex items-center gap-4">
                            <span className="text-gray-500 font-medium">{Math.round(acc.totalCurrentValue).toLocaleString()}원</span>
                            <span className="font-extrabold w-12 text-right text-gray-800">{weight.toFixed(1)}%</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </section>

            <div className="space-y-6 sm:space-y-8">
              <div className="flex items-center justify-between mt-10 px-2">
                <h2 className="text-xl sm:text-2xl font-extrabold text-gray-900 tracking-tight">계좌별 상세 현황</h2>
              </div>
              
              {accountStats.map((acc) => (
                <section key={acc.id} className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-shadow animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <div className="bg-gradient-to-r from-slate-50 to-white border-b border-gray-100 p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-white rounded-2xl shadow-sm border border-gray-100">
                        <Landmark className="w-6 h-6 text-indigo-600" />
                      </div>
                      <div>
                        <h3 className="text-lg sm:text-xl font-bold text-gray-900 truncate tracking-tight">{acc.name}</h3>
                        <p className="text-xs text-gray-500 font-mono mt-1">{acc.accountNumber}</p>
                      </div>
                    </div>
                    <div className="flex gap-2 sm:gap-4 overflow-x-auto hide-scrollbar w-full sm:w-auto pb-2 sm:pb-0">
                      <div className="flex items-center gap-2 text-xs sm:text-sm bg-white px-4 py-2 rounded-xl border border-gray-200 shadow-sm whitespace-nowrap">
                        <span className="text-gray-500 font-semibold">🇰🇷 원화 예수금</span>
                        <span className="font-extrabold text-gray-900">{acc.cashKRW.toLocaleString()}원</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs sm:text-sm bg-white px-4 py-2 rounded-xl border border-gray-200 shadow-sm whitespace-nowrap">
                        <span className="text-gray-500 font-semibold">🇺🇸 달러 예수금</span>
                        <span className="font-extrabold text-gray-900">${acc.cashUSD.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="p-5 sm:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10">
                    <div className="lg:col-span-5 flex flex-col items-center border-b lg:border-b-0 lg:border-r border-gray-100 pb-8 lg:pb-0 lg:pr-10">
                      
                      <div className="w-full mb-8 space-y-3 sm:space-y-4">
                        <div className="flex justify-between items-center text-xs sm:text-sm gap-2">
                          <span className="text-gray-500 font-medium whitespace-nowrap">납입 기간</span>
                          <span className="font-bold text-gray-800 bg-gray-50 px-2 py-1 rounded-md">{acc.durationString}</span>
                        </div>
                        
                        <div className="flex justify-between items-center text-xs sm:text-sm bg-blue-50/50 p-2 rounded-lg border border-blue-100 gap-2">
                          <span className="text-blue-700 font-bold whitespace-nowrap">투자 원금</span>
                          <span className="font-extrabold text-blue-700 text-sm sm:text-base truncate">{Math.round(acc.principal).toLocaleString()}원</span>
                        </div>
                        <div className="flex justify-between items-center text-xs sm:text-sm gap-2 mt-2">
                          <span className="text-gray-500 font-medium whitespace-nowrap">총 자산금액</span>
                          <span className="font-extrabold text-gray-900 truncate">{Math.round(acc.totalCurrentValue).toLocaleString()}원</span>
                        </div>
                        
                        <div className="h-px w-full bg-gray-100 my-2"></div>
                        
                        <div className="flex justify-between items-center text-xs sm:text-sm gap-2">
                          <span className="text-gray-500 font-medium whitespace-nowrap">총 매수금액</span>
                          <span className="font-bold text-gray-800 truncate">{Math.round(acc.stockInvested).toLocaleString()}원</span>
                        </div>
                        <div className="flex justify-between items-center text-xs sm:text-sm gap-2">
                          <span className="text-gray-500 font-medium whitespace-nowrap">총 평가금액</span>
                          <span className="font-extrabold text-gray-900 truncate">{Math.round(acc.stockCurrent).toLocaleString()}원</span>
                        </div>
                        
                        <div className="flex justify-between items-center text-xs sm:text-sm gap-2">
                          <span className="text-gray-500 font-medium whitespace-nowrap">평가손익</span>
                          <span className={`font-extrabold px-2 py-1 rounded-lg truncate ${acc.profit >= 0 ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'}`}>
                            {acc.profit > 0 ? '+' : ''}{Math.round(acc.profit).toLocaleString()}원 ({acc.yieldPercent.toFixed(2)}%)
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-xs sm:text-sm gap-2">
                          <span className="text-gray-500 font-medium whitespace-nowrap">누적 배당금</span>
                          <span className="font-extrabold text-red-500 truncate">+{Math.round(acc.totalDividend).toLocaleString()}원</span>
                        </div>
                        <div className="flex justify-between items-center text-xs sm:text-sm gap-2">
                          <span className="text-gray-500 font-medium whitespace-nowrap">연 환산 수익률</span>
                          <span className={`font-extrabold truncate ${acc.cagr >= 0 ? 'text-red-600' : 'text-blue-600'}`}>
                            {acc.cagr > 0 ? '+' : ''}{acc.cagr.toFixed(2)}%
                          </span>
                        </div>
                      </div>
                      
                      <div className="relative w-40 h-40 sm:w-48 sm:h-48 drop-shadow-sm hover:scale-105 transition-transform duration-500">
                        <div className="absolute inset-0 rounded-full" style={{ background: generateConicGradient(acc.portfolioItems, acc.totalCurrentValue) }}></div>
                        <div className="absolute inset-[20%] bg-white rounded-full flex flex-col items-center justify-center shadow-inner">
                          <span className="text-xs text-gray-500 font-medium mb-0.5">보유 자산</span>
                          <span className="text-2xl font-extrabold text-gray-800">{acc.portfolioItems.length}<span className="text-sm font-medium ml-0.5">개</span></span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="lg:col-span-7">
                      <h4 className="text-sm font-bold text-gray-700 mb-4 sm:mb-5 flex items-center gap-2">
                        <PieChart className="w-4 h-4 text-gray-400" /> 보유 자산 비중 TOP
                      </h4>
                      <div className="space-y-3">
                        {acc.portfolioItems.map((item, index) => {
                          const weight = acc.totalCurrentValue > 0 ? (item.value / acc.totalCurrentValue) * 100 : 0;
                          return (
                            <div key={index} className="flex items-center justify-between p-3.5 hover:bg-gray-50 rounded-2xl transition-all duration-200 border border-transparent hover:border-gray-200 hover:shadow-sm group">
                              <div className="flex items-center gap-3 sm:gap-4 w-1/2 sm:w-1/3">
                                <div className="w-3 h-3 sm:w-4 sm:h-4 rounded-full shadow-sm shrink-0" style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}></div>
                                <div className="truncate">
                                  <p className="font-extrabold text-gray-800 text-xs sm:text-sm truncate group-hover:text-blue-600 transition-colors">{item.name}</p>
                                  {item.ticker && <p className="text-[10px] sm:text-xs text-gray-400 font-medium font-mono mt-0.5">{item.ticker}</p>}
                                </div>
                              </div>
                              <div className="w-1/3 hidden sm:flex items-center gap-2 px-4">
                                <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden shadow-inner">
                                  <div className="h-full rounded-full transition-all duration-1000 ease-out" style={{ width: `${weight}%`, backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}></div>
                                </div>
                              </div>
                              <div className="w-1/2 sm:w-1/3 text-right">
                                <p className="font-extrabold text-gray-900 text-xs sm:text-sm">{Math.round(item.value).toLocaleString()}원</p>
                                <p className="text-[10px] sm:text-xs font-bold text-gray-400 mt-0.5">{weight.toFixed(1)}%</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </section>
              ))}
            </div>
          </div>
        )}

        {/* 탭 2: 계좌 관리 화면 */}
        {activeTab === 'accounts' && (
          <div className="space-y-6 sm:space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-2 bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
              <div>
                <h2 className="text-xl sm:text-2xl font-extrabold text-gray-900 tracking-tight flex items-center gap-2">
                  <Wallet className="w-6 h-6 text-blue-600" /> 계좌 및 종목 관리
                </h2>
                <p className="text-sm text-gray-500 mt-2">선택한 계좌의 개별 종목과 예수금을 정밀하게 관리하세요.</p>
              </div>
              <button 
                onClick={() => setIsAddAccountModalOpen(true)} 
                className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-3 rounded-xl text-sm font-bold transition-all hover:shadow-md hover:-translate-y-0.5 w-full sm:w-auto"
              >
                <Plus className="w-4 h-4 sm:w-5 sm:h-5" /> <span>새 계좌 추가</span>
              </button>
            </div>

            {accountStats.length > 0 && (
              <div className="relative mb-6">
                <select 
                  value={selectedAccountId || ''} 
                  onChange={(e) => setSelectedAccountId(Number(e.target.value))} 
                  className="w-full sm:w-auto min-w-[320px] px-5 py-3.5 bg-white border border-gray-300 hover:border-blue-400 rounded-xl shadow-sm font-extrabold text-gray-800 cursor-pointer appearance-none outline-none focus:ring-2 focus:ring-blue-500/20 transition-all bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%236b7280%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E')] bg-[length:1.2em_1.2em] bg-no-repeat bg-[position:right_1.2rem_center] pr-12"
                >
                  {accountStats.map(acc => <option key={acc.id} value={acc.id}>{acc.name} [{acc.accountNumber}]</option>)}
                </select>
              </div>
            )}

            {accountStats.filter(acc => acc.id === selectedAccountId).map(acc => {
              
              const getValKRW = (val, currency) => currency === 'USD' ? val * exchangeRate : val;
              const enrichedStocks = acc.stocks.map(stock => {
                const isUSD = stock.currency === 'USD';
                const invested = stock.avgPrice * stock.quantity;
                const current = stock.currentPrice * stock.quantity;
                const profit = current - invested;
                const profitPercent = invested > 0 ? ((profit / invested) * 100).toFixed(2) : 0;
                const currentKRW = getValKRW(current, stock.currency);
                const weight = acc.totalCurrentValue > 0 ? (currentKRW / acc.totalCurrentValue) * 100 : 0;
                const stockDividends = acc.dividends.filter(d => d.ticker === stock.ticker);
                const totalDivKRW = stockDividends.reduce((sum, d) => sum + getValKRW(d.amount, d.currency), 0);
                const totalDivOriginal = stockDividends.reduce((sum, d) => sum + d.amount, 0);

                return {
                  ...stock,
                  isUSD, invested, current, profit, profitPercent, currentKRW, weight,
                  totalDivKRW, totalDivOriginal
                };
              });

              const sortedStocks = [...enrichedStocks].sort((a, b) => {
                if (!sortConfig.key) return 0;
                let valA = a[sortConfig.key];
                let valB = b[sortConfig.key];
                if (typeof valA === 'string') valA = valA.toLowerCase();
                if (typeof valB === 'string') valB = valB.toLowerCase();
                if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
                if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
              });

              return (
                <section key={acc.id} className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden mt-6 animate-in fade-in duration-500">
                  <div className="bg-gradient-to-r from-slate-50 to-white border-b border-gray-100 p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
                    <div className="flex items-start sm:items-center gap-4">
                      <div className="p-3 bg-white rounded-2xl shadow-sm border border-gray-100 shrink-0">
                        <Wallet className="w-6 h-6 text-indigo-600" />
                      </div>
                      <div>
                        <h3 className="text-lg sm:text-xl font-extrabold text-gray-900 tracking-tight">{acc.name}</h3>
                        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 text-[10px] sm:text-xs text-gray-500 mt-1.5 font-medium">
                          <span className="font-mono bg-white px-2 py-0.5 rounded-md border border-gray-200 shadow-sm">{acc.accountNumber}</span>
                          <span className="text-gray-300">|</span>
                          <span>개설일: {acc.startDate}</span>
                          <span className="bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded-md font-bold">{acc.durationString}</span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex flex-wrap gap-2 w-full lg:w-auto">
                      <button onClick={() => { setHistoryFilter({startDate:'', endDate:'', ticker:''}); setIsHistoryModalOpen(true); }} className="flex-1 sm:flex-none px-4 py-2 bg-white border border-gray-200 text-gray-700 text-xs sm:text-sm font-bold rounded-xl hover:bg-gray-50 hover:text-blue-600 hover:border-blue-200 transition-all shadow-sm flex items-center justify-center gap-1.5 whitespace-nowrap"><Activity className="w-3.5 h-3.5"/> 거래내역 관리</button>
                      <button onClick={() => { setDividendFilter({startDate:'', endDate:'', ticker:''}); setIsDividendModalOpen(true); }} className="flex-1 sm:flex-none px-4 py-2 bg-white border border-gray-200 text-gray-700 text-xs sm:text-sm font-bold rounded-xl hover:bg-gray-50 hover:text-red-500 hover:border-red-200 transition-all shadow-sm flex items-center justify-center gap-1.5 whitespace-nowrap"><Coins className="w-3.5 h-3.5"/> 배당금 관리</button>
                      <button onClick={() => { const targetAcc = accounts.find(a => a.id === selectedAccountId); setCashEditForm({ cashKRW: targetAcc.cashKRW, cashUSD: targetAcc.cashUSD }); setIsEditCashModalOpen(true); }} className="flex-1 sm:flex-none px-4 py-2 bg-white border border-gray-200 text-gray-700 text-xs sm:text-sm font-bold rounded-xl hover:bg-gray-50 transition-all shadow-sm flex items-center justify-center gap-1.5 whitespace-nowrap"><DollarSign className="w-3.5 h-3.5"/> 예수금 수정</button>
                      <button onClick={() => deleteAccount(acc.id)} className="flex-none px-4 py-2 bg-white border border-gray-200 text-red-500 text-xs sm:text-sm font-bold rounded-xl hover:bg-red-50 hover:border-red-200 transition-all shadow-sm flex items-center justify-center"><Trash2 className="w-4 h-4"/></button>
                    </div>
                  </div>

                  <div className="flex flex-row divide-x divide-gray-100 border-b border-gray-100 bg-slate-50/50 overflow-x-auto hide-scrollbar">
                    <div className="p-3 sm:p-4 text-center flex flex-col justify-center bg-blue-50/30 shrink-0 flex-1 min-w-[100px]">
                      <p className="text-[10px] font-bold text-blue-600 mb-1 uppercase tracking-wider whitespace-nowrap">총 자산금액</p>
                      <p className="font-extrabold text-blue-700 text-[11px] sm:text-sm tracking-tighter whitespace-nowrap">{Math.round(acc.totalCurrentValue).toLocaleString()}원</p>
                    </div>
                    <div className="p-3 sm:p-4 text-center flex flex-col justify-center shrink-0 flex-1 min-w-[100px] bg-slate-100/50">
                      <p className="text-[10px] font-bold text-gray-500 mb-1 uppercase tracking-wider whitespace-nowrap">투자 원금</p>
                      <p className="font-extrabold text-gray-800 text-[11px] sm:text-sm tracking-tighter whitespace-nowrap">{Math.round(acc.principal).toLocaleString()}원</p>
                    </div>
                    <div className="p-3 sm:p-4 text-center flex flex-col justify-center shrink-0 flex-1 min-w-[100px]">
                      <p className="text-[10px] font-bold text-gray-400 mb-1 uppercase tracking-wider whitespace-nowrap">총 매수금액</p>
                      <p className="font-extrabold text-gray-800 text-[11px] sm:text-sm tracking-tighter whitespace-nowrap">{Math.round(acc.stockInvested).toLocaleString()}원</p>
                    </div>
                    <div className="p-3 sm:p-4 text-center flex flex-col justify-center shrink-0 flex-1 min-w-[100px]">
                      <p className="text-[10px] font-bold text-gray-400 mb-1 uppercase tracking-wider whitespace-nowrap">총 평가금액</p>
                      <p className="font-extrabold text-gray-900 text-[11px] sm:text-sm tracking-tighter whitespace-nowrap">{Math.round(acc.stockCurrent).toLocaleString()}원</p>
                    </div>
                    <div className="p-3 sm:p-4 text-center flex flex-col justify-center bg-white shadow-[0_0_15px_rgba(0,0,0,0.02)] shrink-0 flex-1 min-w-[110px]">
                      <p className="text-[10px] font-bold text-gray-400 mb-1 uppercase tracking-wider whitespace-nowrap">평가손익</p>
                      <div className="flex flex-col items-center justify-center gap-0.5 w-full">
                        <p className={`font-extrabold text-[11px] sm:text-sm tracking-tighter whitespace-nowrap w-full ${acc.profit >= 0 ? 'text-red-500' : 'text-blue-500'}`}>
                          {acc.profit > 0 ? '+' : ''}{Math.round(acc.profit).toLocaleString()}원
                        </p>
                        <p className={`text-[9px] sm:text-[10px] font-bold bg-gray-50 px-1.5 py-0.5 rounded whitespace-nowrap max-w-full ${acc.yieldPercent >= 0 ? 'text-red-500' : 'text-blue-500'}`}>
                          {acc.yieldPercent > 0 ? '+' : ''}{acc.yieldPercent.toFixed(2)}%
                        </p>
                      </div>
                    </div>
                    <div className="p-3 sm:p-4 text-center flex flex-col justify-center shrink-0 flex-1 min-w-[100px]">
                      <p className="text-[10px] font-bold text-gray-400 mb-1 uppercase tracking-wider whitespace-nowrap">총 배당금</p>
                      <p className="font-extrabold text-red-500 text-[11px] sm:text-sm tracking-tighter whitespace-nowrap">+{Math.round(acc.totalDividend).toLocaleString()}원</p>
                    </div>
                    <div className="p-3 sm:p-4 text-center flex flex-col justify-center bg-gray-100/50 shrink-0 flex-1 min-w-[120px]">
                      <p className="text-[10px] font-bold text-gray-500 mb-1.5 uppercase tracking-wider whitespace-nowrap">예수금</p>
                      <div className="flex flex-col justify-center items-center gap-1 w-full">
                        <p className="font-bold text-gray-700 text-[10px] sm:text-xs bg-white px-1.5 py-1 rounded border border-gray-200 shadow-sm w-full whitespace-nowrap">🇰🇷 {acc.cashKRW.toLocaleString()}</p>
                        <p className="font-bold text-gray-700 text-[10px] sm:text-xs bg-white px-1.5 py-1 rounded border border-gray-200 shadow-sm w-full whitespace-nowrap">🇺🇸 ${acc.cashUSD.toLocaleString()}</p>
                      </div>
                    </div>
                  </div>

                  <div className="p-0 overflow-x-auto bg-white hide-scrollbar">
                    <div className="flex justify-between items-center p-4 sm:p-5 border-b border-gray-100 min-w-[700px] bg-white sticky left-0">
                      <h4 className="font-extrabold text-gray-900 text-sm sm:text-base flex items-center gap-2">
                        보유 종목 <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-md text-xs">{acc.stocks.length}</span>
                      </h4>
                      <button 
                        onClick={() => { setSearchMessage(null); setIsAddStockModalOpen(true); }} 
                        className="flex items-center gap-1.5 bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-bold transition-colors border border-slate-200 hover:border-blue-200"
                      >
                        <Plus className="w-4 h-4" /> <span>새 종목 추가</span>
                      </button>
                    </div>
                    
                    <table className="w-full text-left border-collapse min-w-[800px]">
                      <thead>
                        <tr className="bg-slate-50 text-gray-500 text-[10px] sm:text-xs uppercase tracking-wider border-b border-gray-200">
                          <th className="px-5 py-4 font-bold whitespace-nowrap cursor-pointer hover:bg-slate-200 transition-colors" onClick={() => requestSort('name')}>
                            종목명/티커 <SortIcon columnKey="name" />
                          </th>
                          <th className="px-5 py-4 font-bold text-right whitespace-nowrap">보유 수량</th>
                          <th className="px-5 py-4 font-bold text-right whitespace-nowrap">매수 평균가</th>
                          <th className="px-5 py-4 font-bold text-right whitespace-nowrap">총 매수금액</th>
                          <th className="px-5 py-4 font-bold text-right whitespace-nowrap">현재가</th>
                          <th className="px-5 py-4 font-bold text-right whitespace-nowrap cursor-pointer hover:bg-slate-200 transition-colors" onClick={() => requestSort('currentKRW')}>
                            평가 금액 <SortIcon columnKey="currentKRW" />
                          </th>
                          <th className="px-5 py-4 font-bold text-right whitespace-nowrap cursor-pointer hover:bg-slate-200 transition-colors text-indigo-600" onClick={() => requestSort('weight')}>
                            비중 <SortIcon columnKey="weight" />
                          </th>
                          <th className="px-5 py-4 font-bold text-right whitespace-nowrap">누적 배당금</th>
                          <th className="px-5 py-4 font-bold text-center w-28 whitespace-nowrap">내역</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {sortedStocks.length === 0 ? (
                          <tr>
                            <td colSpan="9" className="px-6 py-12 text-center text-gray-400 font-medium text-sm">
                              등록된 종목이 없습니다. 우측 상단의 추가 버튼을 눌러주세요.
                            </td>
                          </tr>
                        ) : (
                          sortedStocks.map((stock) => {
                            return (
                              <tr key={stock.id} className="hover:bg-slate-50/80 transition-colors group">
                                <td className="px-5 py-4 whitespace-nowrap">
                                  <div className="font-extrabold text-gray-900 text-xs sm:text-sm flex items-center gap-1.5 sm:gap-2">
                                    {stock.name}
                                    <span className={`text-[9px] sm:text-[10px] px-1.5 py-0.5 rounded-md font-bold shadow-sm ${stock.isUSD ? 'bg-green-100 text-green-700 border border-green-200' : 'bg-blue-100 text-blue-700 border border-blue-200'}`}>
                                      {stock.currency}
                                    </span>
                                  </div>
                                  <div className="text-[10px] sm:text-xs text-gray-400 font-medium font-mono mt-0.5">{stock.ticker}</div>
                                </td>
                                <td className="px-5 py-4 text-right font-bold text-gray-700 text-xs sm:text-sm bg-gray-50/30 whitespace-nowrap">
                                  {stock.quantity.toLocaleString()}주
                                </td>
                                <td className="px-5 py-4 text-right text-xs sm:text-sm font-medium text-gray-500 whitespace-nowrap">
                                  {stock.isUSD ? '$' : ''}{stock.avgPrice.toLocaleString()}
                                </td>
                                <td className="px-5 py-4 text-right text-xs sm:text-sm font-bold text-gray-700 whitespace-nowrap">
                                  {stock.isUSD ? '$' : ''}{stock.invested.toLocaleString()}
                                </td>
                                <td className="px-5 py-4 text-right text-xs sm:text-sm font-extrabold text-gray-900 bg-blue-50/20 whitespace-nowrap">
                                  {stock.isUSD ? '$' : ''}{stock.currentPrice.toLocaleString()}
                                </td>
                                <td className="px-5 py-4 text-right whitespace-nowrap">
                                  {stock.isUSD ? (
                                    <div className="flex flex-col items-end gap-0.5">
                                      <span className="font-extrabold text-gray-900 text-xs sm:text-sm">${stock.current.toLocaleString()}</span>
                                      <span className="text-[10px] text-gray-500 font-medium">({Math.round(stock.currentKRW).toLocaleString()}원)</span>
                                    </div>
                                  ) : (
                                    <div className="font-extrabold text-gray-900 text-xs sm:text-sm">{Math.round(stock.currentKRW).toLocaleString()}원</div>
                                  )}
                                  {stock.invested > 0 && (
                                    <div className={`text-[10px] sm:text-xs font-bold inline-block px-1.5 py-0.5 rounded mt-0.5 ${stock.profit >= 0 ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'}`}>
                                      {stock.profit >= 0 ? '+' : ''}{stock.profitPercent}%
                                    </div>
                                  )}
                                </td>
                                <td className="px-5 py-4 text-right font-extrabold text-indigo-600 text-xs sm:text-sm bg-indigo-50/20 whitespace-nowrap">
                                  {stock.weight.toFixed(1)}%
                                </td>
                                <td className="px-5 py-4 text-right bg-red-50/10 whitespace-nowrap">
                                  {stock.totalDivKRW > 0 ? (
                                    <div className="flex flex-col items-end gap-0.5">
                                      <span className="font-extrabold text-xs sm:text-sm text-red-600">{stock.isUSD ? '$' : ''}{stock.totalDivOriginal.toLocaleString()}</span>
                                      {stock.isUSD && <span className="text-[9px] sm:text-[10px] text-gray-400 font-medium">({Math.round(stock.totalDivKRW).toLocaleString()}원)</span>}
                                    </div>
                                  ) : (
                                    <span className="text-gray-300 text-xs sm:text-sm font-medium">-</span>
                                  )}
                                </td>
                                <td className="px-5 py-4 text-center whitespace-nowrap">
                                  <div className="flex justify-center items-center gap-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                                    <button onClick={() => { setManagingStockId(stock.id); setIsStockManageModalOpen(true); setManageTab('history'); setDivForm(prev => ({ ...prev, currency: stock.currency })); }} className="text-blue-600 hover:text-white bg-blue-50 hover:bg-blue-600 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors shadow-sm">
                                      입력
                                    </button>
                                    <button onClick={() => deleteStockFromAccount(acc.id, stock.id)} className="text-gray-400 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50 transition-colors" title="종목 삭제">
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              );
            })}
          </div>
        )}

        {/* 탭 3: 리밸런싱 화면 */}
        {activeTab === 'rebalancing' && (() => {
          const activeAcc = accountStats.find(a => a.id === selectedAccountId);
          if (!activeAcc) return null;
          const accTargetWeights = activeAcc.targetWeights || {};
          const totalTargetWeight = activeAcc.portfolioItems.reduce((sum, item) => sum + (Number(accTargetWeights[item.ticker]) || 0), 0);

          return (
            <div className="space-y-6 sm:space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <div>
                  <h2 className="text-xl sm:text-2xl font-extrabold text-gray-900 tracking-tight flex items-center gap-2">
                    <PieChart className="w-6 h-6 text-blue-600" /> 포트폴리오 자동 리밸런싱
                  </h2>
                  <p className="text-sm text-gray-500 mt-2">목표 비중을 입력하면 자동으로 파이어베이스에 안전하게 저장됩니다.</p>
                </div>
              </div>

              {accountStats.length > 0 && (
                <div className="relative">
                  <select 
                    value={selectedAccountId || ''} 
                    onChange={(e) => setSelectedAccountId(Number(e.target.value))} 
                    className="w-full sm:w-auto min-w-0 sm:min-w-[320px] px-5 py-3.5 bg-white border border-gray-300 hover:border-blue-400 rounded-xl shadow-sm font-extrabold text-gray-800 cursor-pointer appearance-none outline-none focus:ring-2 focus:ring-blue-500/20 transition-all bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%236b7280%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E')] bg-[length:1.2em_1.2em] bg-no-repeat bg-[position:right_1.2rem_center] pr-12"
                  >
                    {accountStats.map(acc => <option key={acc.id} value={acc.id}>{acc.name} [{acc.accountNumber}]</option>)}
                  </select>
                </div>
              )}

              <section className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="bg-gradient-to-r from-slate-50 to-white border-b border-gray-100 p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-white rounded-2xl shadow-sm border border-gray-100">
                      <PieChart className="w-6 h-6 text-indigo-600" />
                    </div>
                    <div>
                      <h3 className="text-lg sm:text-xl font-extrabold text-gray-900 tracking-tight">목표 비중 설정 <span className="text-blue-600">({activeAcc.name})</span></h3>
                      <p className="text-xs sm:text-sm font-medium text-gray-500 mt-1">현재 총 자산: <span className="font-bold text-gray-800">{Math.round(activeAcc.totalCurrentValue).toLocaleString()}원</span></p>
                    </div>
                  </div>
                  <div className={`px-6 py-3 rounded-2xl font-extrabold text-sm sm:text-base text-center border shadow-sm transition-colors duration-300 ${totalTargetWeight === 100 ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-600 border-red-200'}`}>
                    현재 합계: {totalTargetWeight}% 
                    {totalTargetWeight !== 100 && <span className="text-xs font-bold ml-2 opacity-80 block sm:inline">(100%를 맞춰주세요)</span>}
                    {totalTargetWeight === 100 && <span className="text-xs font-bold ml-2 opacity-80 block sm:inline">완벽합니다! ✨</span>}
                  </div>
                </div>

                <div className="p-0 overflow-x-auto hide-scrollbar">
                  <table className="w-full text-left border-collapse min-w-[800px]">
                    <thead>
                      <tr className="bg-slate-50 text-gray-500 text-[10px] sm:text-xs uppercase tracking-wider border-b border-gray-200">
                        <th className="px-5 py-4 font-bold">자산명</th>
                        <th className="px-5 py-4 font-bold text-right">현재 평가액</th>
                        <th className="px-5 py-4 font-bold text-right">현재 비중</th>
                        <th className="px-5 py-4 font-bold text-center">목표 비중 입력 (%)</th>
                        <th className="px-5 py-4 font-bold text-right">목표 평가액</th>
                        <th className="px-5 py-4 font-bold text-right w-48">리밸런싱 (수량/금액)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {activeAcc.portfolioItems.length === 0 ? (
                        <tr><td colSpan="6" className="px-6 py-12 text-center text-gray-400 font-medium text-sm">보유 중인 자산이 없습니다. 먼저 계좌에 자산을 추가해주세요.</td></tr>
                      ) : (
                        activeAcc.portfolioItems.map(item => {
                          const currentWeight = activeAcc.totalCurrentValue > 0 ? (item.value / activeAcc.totalCurrentValue) * 100 : 0;
                          const targetWeight = Number(accTargetWeights[item.ticker]) || 0;
                          const targetValue = activeAcc.totalCurrentValue * (targetWeight / 100);
                          const difference = targetValue - item.value;
                          const isBuy = difference > 0;
                          let rebalanceContent = <span className="text-gray-300 text-xs sm:text-sm font-bold bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-100">유지</span>;

                          if (Math.abs(difference) > 1) {
                            if (item.isCash) {
                              rebalanceContent = (
                                <div className={`font-extrabold text-xs sm:text-sm flex items-center justify-end gap-1.5 px-3 py-1.5 rounded-lg shadow-sm ${isBuy ? 'bg-red-50 text-red-600 border border-red-100' : 'bg-blue-50 text-blue-600 border border-blue-100'}`}>
                                  {isBuy ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                                  {Math.round(Math.abs(difference)).toLocaleString()}원 {isBuy ? '추가 확보' : '사용 가능'}
                                </div>
                              );
                            } else {
                              const priceKRW = getValKRW(item.currentPrice, item.currency);
                              const displayQty = Math.round(Math.abs(difference) / priceKRW); 
                              if (displayQty > 0) {
                                rebalanceContent = (
                                  <div className={`font-bold text-xs sm:text-sm flex flex-col items-end justify-center px-3 py-2 rounded-lg shadow-sm border ${isBuy ? 'bg-red-50 text-red-600 border-red-100' : 'bg-blue-50 text-blue-600 border-blue-100'}`}>
                                    <div className="flex items-center gap-1.5 font-extrabold">
                                      {isBuy ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                                      {isBuy ? '매수' : '매도'} {displayQty.toLocaleString()}주
                                    </div>
                                    <span className="text-[10px] sm:text-[11px] opacity-70 font-semibold mt-0.5">({Math.round(Math.abs(difference)).toLocaleString()}원)</span>
                                  </div>
                                );
                              }
                            }
                          }

                          return (
                            <tr key={item.ticker} className="hover:bg-slate-50/80 transition-colors">
                              <td className="px-5 py-4">
                                <div className="font-extrabold text-gray-900 text-xs sm:text-sm flex items-center gap-1.5 sm:gap-2">
                                  {item.name}
                                  {item.isCash ? (
                                    <span className="text-[9px] sm:text-[10px] px-1.5 py-0.5 rounded-md font-bold bg-yellow-100 text-yellow-700 border border-yellow-200 shadow-sm">현금</span>
                                  ) : (
                                    <span className={`text-[9px] sm:text-[10px] px-1.5 py-0.5 rounded-md font-bold shadow-sm ${item.currency === 'USD' ? 'bg-green-100 text-green-700 border border-green-200' : 'bg-blue-100 text-blue-700 border border-blue-200'}`}>{item.currency}</span>
                                  )}
                                </div>
                                <div className="text-[10px] sm:text-xs text-gray-400 font-medium font-mono mt-0.5">
                                  {item.ticker === 'KRW_CASH' || item.ticker === 'USD_CASH' ? '' : item.ticker}
                                </div>
                              </td>
                              <td className="px-5 py-4 text-right font-extrabold text-gray-700 text-xs sm:text-sm">{Math.round(item.value).toLocaleString()}원</td>
                              <td className="px-5 py-4 text-right font-bold text-gray-400 text-xs sm:text-sm bg-gray-50/30">{currentWeight.toFixed(1)}%</td>
                              <td className="px-5 py-4 text-center bg-indigo-50/30">
                                <div className="flex justify-center items-center gap-1.5">
                                  <input 
                                    type="number" 
                                    min="0" max="100" 
                                    value={accTargetWeights[item.ticker] ?? ''} 
                                    onChange={(e) => handleTargetWeightChange(activeAcc.id, item.ticker, e.target.value)} 
                                    placeholder="0" 
                                    className="w-16 sm:w-20 px-2 sm:px-3 py-1.5 sm:py-2 border border-indigo-200 rounded-lg text-right focus:ring-2 focus:ring-indigo-500 outline-none text-sm font-extrabold text-indigo-700 bg-white shadow-inner transition-all hover:border-indigo-400" 
                                  />
                                  <span className="text-indigo-400 font-bold text-xs sm:text-sm">%</span>
                                </div>
                              </td>
                              <td className="px-5 py-4 text-right font-extrabold text-gray-900 text-xs sm:text-sm">{targetWeight > 0 ? Math.round(targetValue).toLocaleString() + '원' : <span className="text-gray-300">-</span>}</td>
                              <td className="px-5 py-4 text-right">{rebalanceContent}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          );
        })()}

      </main>

      {/* 모달 1: 새 계좌 추가 모달 */}
      {isAddAccountModalOpen && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="px-6 py-5 border-b border-gray-100 flex justify-between items-center bg-white">
              <h3 className="text-lg font-extrabold text-gray-900 flex items-center gap-2"><Wallet className="w-5 h-5 text-blue-600"/> 새 계좌 추가</h3>
              <button onClick={() => setIsAddAccountModalOpen(false)} className="text-gray-400 hover:text-gray-700 p-1 rounded-full hover:bg-gray-100 transition-colors"><X size={20} /></button>
            </div>
            <form onSubmit={handleAddAccount} className="p-6 space-y-5 bg-slate-50/50">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1.5">계좌명 <span className="text-red-500">*</span></label>
                <input type="text" required placeholder="ex: ISA (미래에셋증권)" className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm" value={newAccountForm.name} onChange={(e) => setNewAccountForm({...newAccountForm, name: e.target.value})} />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1.5">계좌번호</label>
                <input type="text" placeholder="ex: 123-4567-8901" className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm" value={newAccountForm.accountNumber} onChange={(e) => setNewAccountForm({...newAccountForm, accountNumber: e.target.value})} />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1.5">계좌 개설일 <span className="text-red-500">*</span></label>
                <input type="date" required className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm" value={newAccountForm.startDate} onChange={(e) => setNewAccountForm({...newAccountForm, startDate: e.target.value})} />
              </div>
              <div className="pt-4 flex gap-3">
                <button type="button" onClick={() => setIsAddAccountModalOpen(false)} className="flex-1 px-4 py-3 bg-white border border-gray-200 text-gray-700 rounded-xl text-sm font-bold hover:bg-gray-50 transition-colors shadow-sm">취소</button>
                <button type="submit" className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition-colors shadow-sm shadow-blue-600/20">완료</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 모달 2: 예수금 수정 모달 */}
      {isEditCashModalOpen && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="px-6 py-5 border-b border-gray-100 flex justify-between items-center bg-white">
              <h3 className="text-lg font-extrabold text-gray-900 flex items-center gap-2"><DollarSign className="w-5 h-5 text-green-600"/> 예수금 수정</h3>
              <button onClick={() => setIsEditCashModalOpen(false)} className="text-gray-400 hover:text-gray-700 p-1 rounded-full hover:bg-gray-100 transition-colors"><X size={20} /></button>
            </div>
            <form onSubmit={handleEditCash} className="p-6 space-y-5 bg-slate-50/50">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1.5 flex items-center gap-1.5">🇰🇷 원화 예수금 (KRW)</label>
                <div className="relative">
                  <input type="number" min="0" className="w-full px-4 py-3 pr-8 border border-gray-200 rounded-xl outline-none text-sm font-extrabold text-gray-900 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm" value={cashEditForm.cashKRW} onChange={(e) => setCashEditForm({...cashEditForm, cashKRW: e.target.value})} />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-sm">원</span>
                </div>
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1.5 flex items-center gap-1.5">🇺🇸 달러 예수금 (USD)</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-sm">$</span>
                  <input type="number" min="0" step="any" className="w-full pl-8 py-3 border border-gray-200 rounded-xl outline-none text-sm font-extrabold text-gray-900 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm" value={cashEditForm.cashUSD} onChange={(e) => setCashEditForm({...cashEditForm, cashUSD: e.target.value})} />
                </div>
              </div>
              <div className="pt-4 flex gap-3">
                <button type="button" onClick={() => setIsEditCashModalOpen(false)} className="flex-1 px-4 py-3 bg-white border border-gray-200 text-gray-700 rounded-xl text-sm font-bold hover:bg-gray-50 transition-colors shadow-sm">취소</button>
                <button type="submit" className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition-colors shadow-sm shadow-blue-600/20">저장하기</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 모달 3: 종목 추가 모달 */}
      {isAddStockModalOpen && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="px-6 py-5 border-b border-gray-100 flex justify-between items-center bg-white">
              <h3 className="text-lg font-extrabold text-gray-900 flex items-center gap-2"><Plus className="w-5 h-5 text-blue-600"/> 새 종목 추가</h3>
              <button onClick={() => setIsAddStockModalOpen(false)} className="text-gray-400 hover:text-gray-700 p-1 rounded-full hover:bg-gray-100 transition-colors"><X size={20} /></button>
            </div>
            <div className="p-6 bg-slate-50/50">
              {searchMessage && <div className={`mb-5 p-4 rounded-xl text-sm font-bold animate-in fade-in ${searchMessage.type === 'error' ? 'bg-red-50 text-red-600 border border-red-100' : 'bg-blue-50 text-blue-600 border border-blue-100'}`}>{searchMessage.text}</div>}
              <form onSubmit={handleAddStock} className="space-y-5">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1.5">티커/종목코드 <span className="text-red-500">*</span></label>
                  <div className="flex gap-2">
                    <input type="text" required placeholder="예: AAPL, 005930" className="flex-1 px-4 py-3 border border-gray-200 rounded-xl outline-none text-sm font-bold focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm" value={newStockForm.ticker} onChange={(e) => setNewStockForm({...newStockForm, ticker: e.target.value})} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); fetchStockInfoFromAPI(); } }} />
                    <button type="button" onClick={fetchStockInfoFromAPI} disabled={isSearchingTicker || !newStockForm.ticker.trim()} className="px-5 py-3 bg-white text-slate-700 text-sm font-bold rounded-xl border border-slate-200 hover:bg-slate-50 hover:border-slate-300 disabled:opacity-50 transition-all shadow-sm flex items-center gap-1.5">
                      {isSearchingTicker ? <RefreshCcw className="w-4 h-4 animate-spin text-blue-600" /> : <Search className="w-4 h-4 text-blue-600" />}<span className="hidden sm:inline">자동조회</span>
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1.5">통화 구분 <span className="text-red-500">*</span></label>
                  <select className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none bg-white text-sm font-bold focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm" value={newStockForm.currency} onChange={(e) => setNewStockForm({...newStockForm, currency: e.target.value})}>
                    <option value="KRW">🇰🇷 원화 (KRW) - 국내주식</option>
                    <option value="USD">🇺🇸 달러 (USD) - 미국주식</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1.5">종목명 <span className="text-red-500">*</span></label>
                  <input type="text" required placeholder="조회 시 자동입력됨" className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none text-sm font-bold focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm" value={newStockForm.name} onChange={(e) => setNewStockForm({...newStockForm, name: e.target.value})} />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1.5">현재가 <span className="text-red-500">*</span></label>
                  <input type="number" min="0" step="any" required placeholder="0" className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none text-sm font-extrabold focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm" value={newStockForm.currentPrice} onChange={(e) => setNewStockForm({...newStockForm, currentPrice: e.target.value})} />
                </div>
                <div className="pt-4 flex gap-3">
                  <button type="button" onClick={() => setIsAddStockModalOpen(false)} className="flex-1 px-4 py-3 bg-white border border-gray-200 text-gray-700 rounded-xl text-sm font-bold hover:bg-gray-50 transition-colors shadow-sm">취소</button>
                  <button type="submit" className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition-colors shadow-sm shadow-blue-600/20">추가하기</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* 모달 4: 개별 종목 매수/매도/배당금 관리 모달 */}
      {isStockManageModalOpen && (() => {
        const acc = accounts.find(a => a.id === selectedAccountId);
        const stock = acc?.stocks.find(s => s.id === managingStockId);
        if (!stock) return null;
        const stockDividends = acc.dividends.filter(d => d.ticker === stock.ticker).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        return (
          <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-300">
              <div className="px-6 py-5 border-b border-gray-100 flex justify-between items-start bg-white shrink-0">
                <div>
                  <h3 className="text-lg font-extrabold text-gray-900 flex items-center gap-2">
                    {stock.name} 
                    <span className="text-[10px] sm:text-xs font-bold px-2 py-0.5 bg-gray-100 text-gray-600 rounded-md font-mono border border-gray-200 shadow-sm">{stock.ticker}</span>
                  </h3>
                  <p className="text-xs text-gray-500 mt-1.5 font-medium">거래 및 배당금 내역을 추가하여 평균단가를 맞추세요.</p>
                </div>
                <button onClick={() => setIsStockManageModalOpen(false)} className="text-gray-400 hover:text-gray-700 p-1 rounded-full hover:bg-gray-100 transition-colors"><X size={20} /></button>
              </div>
              <div className="flex bg-slate-50 border-b border-gray-100 shrink-0 p-1">
                <button onClick={() => setManageTab('history')} className={`flex-1 py-3 text-sm font-extrabold rounded-xl transition-all duration-200 ${manageTab === 'history' ? 'bg-white text-blue-600 shadow-sm border border-gray-200/60' : 'text-gray-400 hover:text-gray-600'}`}>매수/매도 입력</button>
                <button onClick={() => setManageTab('dividend')} className={`flex-1 py-3 text-sm font-extrabold rounded-xl transition-all duration-200 ${manageTab === 'dividend' ? 'bg-white text-blue-600 shadow-sm border border-gray-200/60' : 'text-gray-400 hover:text-gray-600'}`}>배당금 입력</button>
              </div>
              <div className="p-6 overflow-y-auto bg-slate-50/30">
                {manageTab === 'history' ? (
                  <form onSubmit={handleAddTransaction} className="space-y-5">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1.5">구분</label>
                        <select className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm font-bold bg-white focus:ring-2 focus:ring-blue-500/20 outline-none shadow-sm" value={txForm.type} onChange={(e) => setTxForm({...txForm, type: e.target.value})}>
                          <option value="buy">📈 매수 (Buy)</option>
                          <option value="sell">📉 매도 (Sell)</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1.5">일자</label>
                        <input type="date" required className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm font-bold focus:ring-2 focus:ring-blue-500/20 outline-none shadow-sm" value={txForm.date} onChange={(e) => setTxForm({...txForm, date: e.target.value})} />
                      </div>
                      <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1.5">체결 단가 <span className="text-[10px] text-gray-400 font-normal">({stock.currency})</span></label>
                        <input type="number" min="0" step="any" required placeholder="0" className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm font-extrabold focus:ring-2 focus:ring-blue-500/20 outline-none shadow-sm" value={txForm.price} onChange={(e) => setTxForm({...txForm, price: e.target.value})} />
                      </div>
                      <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1.5">수량</label>
                        <div className="relative">
                          <input type="number" min="0" step="any" required placeholder="0" className="w-full px-4 py-3 pr-8 border border-gray-200 rounded-xl text-sm font-extrabold focus:ring-2 focus:ring-blue-500/20 outline-none shadow-sm" value={txForm.quantity} onChange={(e) => setTxForm({...txForm, quantity: e.target.value})} />
                          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-sm">주</span>
                        </div>
                      </div>
                    </div>
                    <div className="pt-4">
                      <button type="submit" className={`w-full px-4 py-3.5 text-white rounded-xl text-sm font-extrabold transition-all shadow-sm ${txForm.type === 'buy' ? 'bg-red-500 hover:bg-red-600 shadow-red-500/20' : 'bg-blue-500 hover:bg-blue-600 shadow-blue-500/20'}`}>
                        {txForm.type === 'buy' ? '매수 내역 추가하기' : '매도 내역 추가하기'}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="space-y-6">
                    <form onSubmit={handleAddDividend} className="space-y-5">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-bold text-gray-700 mb-1.5">일자</label>
                          <input type="date" required className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm font-bold focus:ring-2 focus:ring-blue-500/20 outline-none shadow-sm" value={divForm.date} onChange={(e) => setDivForm({...divForm, date: e.target.value})} />
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-gray-700 mb-1.5">입금 통화</label>
                          <select className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm font-bold bg-white focus:ring-2 focus:ring-blue-500/20 outline-none shadow-sm" value={divForm.currency} onChange={(e) => setDivForm({...divForm, currency: e.target.value})}>
                            <option value="KRW">🇰🇷 원화 (KRW)</option>
                            <option value="USD">🇺🇸 달러 (USD)</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1.5">총 배당금액</label>
                        <input type="number" min="0" step="any" required placeholder="0" className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm font-extrabold focus:ring-2 focus:ring-blue-500/20 outline-none shadow-sm" value={divForm.amount} onChange={(e) => setDivForm({...divForm, amount: e.target.value})} />
                      </div>
                      <div className="pt-2">
                        <button type="submit" className="w-full px-4 py-3.5 bg-green-600 text-white rounded-xl text-sm font-extrabold hover:bg-green-700 transition-all shadow-sm shadow-green-600/20">
                          배당금 입금 내역 추가
                        </button>
                      </div>
                    </form>
                    <div className="pt-5 border-t border-gray-200">
                      <h4 className="text-xs sm:text-sm font-extrabold text-gray-700 mb-3 flex items-center gap-1.5"><Coins className="w-4 h-4 text-yellow-500"/> 최근 배당금 입력 내역</h4>
                      <div className="max-h-32 overflow-y-auto pr-2 hide-scrollbar">
                        {stockDividends.length === 0 ? (
                          <p className="text-xs font-medium text-gray-400 text-center py-6 bg-white rounded-xl border border-dashed border-gray-200">입력된 배당금 내역이 없습니다.</p>
                        ) : (
                          <ul className="space-y-2">
                            {stockDividends.map(d => (
                              <li key={d.id} className="flex justify-between items-center bg-white p-3 rounded-xl border border-gray-100 shadow-sm text-xs sm:text-sm transition-all hover:border-gray-300">
                                <span className="text-gray-500 font-medium">{d.date}</span>
                                <span className="font-extrabold text-green-600">{d.currency === 'USD' ? '$' : ''}{d.amount.toLocaleString()} <span className="text-[10px] text-gray-400 ml-0.5">{d.currency}</span></span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* 모달 5: 전체 실현손익 내역 조회 모달 */}
      {isHistoryModalOpen && (() => {
        const selectedAccount = accounts.find(a => a.id === selectedAccountId);
        const accountHistory = selectedAccount?.history || [];
        const filteredHistory = accountHistory.filter(record => {
          const matchStartDate = historyFilter.startDate ? record.date >= historyFilter.startDate : true;
          const matchEndDate = historyFilter.endDate ? record.date <= historyFilter.endDate : true;
          const matchTicker = historyFilter.ticker ? record.ticker === historyFilter.ticker : true;
          return matchStartDate && matchEndDate && matchTicker;
        }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        const sellHistory = filteredHistory.filter(h => h.type === 'sell');
        let totalRealizedInvestedKRW = 0;
        let totalRealizedProfitKRW = 0;
        sellHistory.forEach(record => {
            const isUSD = record.currency === 'USD';
            const rate = isUSD ? exchangeRate : 1;
            const invested = (record.avgBuyPrice || 0) * record.quantity * rate;
            const sold = record.price * record.quantity * rate;
            totalRealizedInvestedKRW += invested;
            totalRealizedProfitKRW += (sold - invested);
        });
        const totalRealizedYield = totalRealizedInvestedKRW > 0 ? (totalRealizedProfitKRW / totalRealizedInvestedKRW) * 100 : 0;
        const uniqueHistoryStocks = Array.from(new Set(accountHistory.map(h => h.ticker))).map(ticker => {
            return { ticker, name: accountHistory.find(h => h.ticker === ticker).name };
        });

        return (
          <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl overflow-hidden max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-300">
              <div className="px-6 py-5 border-b border-gray-100 flex justify-between items-center bg-white shrink-0">
                <h3 className="text-lg sm:text-xl font-extrabold text-gray-900 flex items-center gap-2"><Activity className="w-5 h-5 text-blue-600"/> 전체 실현손익 거래내역</h3>
                <button onClick={() => setIsHistoryModalOpen(false)} className="text-gray-400 hover:text-gray-700 p-1 rounded-full hover:bg-gray-100 transition-colors"><X size={24} /></button>
              </div>
              
              <div className="p-6 border-b border-gray-100 bg-gradient-to-r from-slate-50 to-white shrink-0">
                <p className="text-xs font-bold text-gray-500 mb-2 uppercase tracking-wider">조회 조건 실현 손익 (원화 환산)</p>
                <div className="flex items-end gap-3">
                  <p className={`text-3xl sm:text-4xl font-extrabold tracking-tight ${totalRealizedProfitKRW >= 0 ? 'text-red-500' : 'text-blue-500'}`}>
                    {totalRealizedProfitKRW > 0 ? '+' : ''}{Math.round(totalRealizedProfitKRW).toLocaleString()}원
                  </p>
                  <p className={`text-lg sm:text-xl font-bold mb-1 px-2 py-1 rounded-lg ${totalRealizedProfitKRW >= 0 ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'}`}>
                    {totalRealizedYield.toFixed(2)}%
                  </p>
                </div>
                <p className="text-[10px] sm:text-xs font-medium text-gray-400 mt-2">※ 매도(Sell) 내역 기준으로, 당시의 평단가 대비 실현된 손익을 계산합니다.</p>
              </div>

              <div className="px-6 py-4 bg-white border-b border-gray-100 flex flex-wrap gap-3 items-center shrink-0">
                <div className="flex items-center gap-2">
                  <input type="date" className="px-3 py-2 border border-gray-200 rounded-xl text-sm font-semibold outline-none focus:ring-2 focus:ring-blue-500/20" value={historyFilter.startDate} onChange={(e) => setHistoryFilter({ ...historyFilter, startDate: e.target.value })} />
                  <span className="text-gray-400 text-sm font-bold">~</span>
                  <input type="date" className="px-3 py-2 border border-gray-200 rounded-xl text-sm font-semibold outline-none focus:ring-2 focus:ring-blue-500/20" value={historyFilter.endDate} onChange={(e) => setHistoryFilter({ ...historyFilter, endDate: e.target.value })} />
                </div>
                <select className="px-4 py-2 border border-gray-200 rounded-xl text-sm font-semibold outline-none focus:ring-2 focus:ring-blue-500/20 bg-white" value={historyFilter.ticker} onChange={(e) => setHistoryFilter({ ...historyFilter, ticker: e.target.value })}>
                  <option value="">전체 종목 보기</option>
                  {uniqueHistoryStocks.map(stock => (<option key={stock.ticker} value={stock.ticker}>{stock.name} ({stock.ticker})</option>))}
                </select>
                {(historyFilter.startDate || historyFilter.endDate || historyFilter.ticker) && (
                  <button onClick={() => setHistoryFilter({ startDate: '', endDate: '', ticker: '' })} className="px-4 py-2 text-sm text-blue-600 font-bold bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors">필터 초기화</button>
                )}
              </div>

              <div className="overflow-y-auto overflow-x-auto hide-scrollbar bg-slate-50/30">
                <table className="w-full text-left border-collapse whitespace-nowrap min-w-[800px]">
                  <thead className="sticky top-0 bg-white shadow-sm z-10">
                    <tr className="text-gray-500 text-[10px] sm:text-xs uppercase tracking-wider border-b border-gray-200">
                      <th className="px-6 py-4 font-bold">일자</th>
                      <th className="px-4 py-4 font-bold text-center">구분</th>
                      <th className="px-6 py-4 font-bold">종목명/티커</th>
                      <th className="px-6 py-4 font-bold text-right">체결 단가</th>
                      <th className="px-6 py-4 font-bold text-right">체결 수량</th>
                      <th className="px-6 py-4 font-bold text-right">실현손익 (수익률)</th>
                      <th className="px-4 py-4 font-bold text-center w-20">관리</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredHistory.length === 0 ? (
                      <tr><td colSpan="7" className="px-6 py-16 text-center text-gray-400 font-medium text-sm">해당 조건의 거래 내역이 없습니다.</td></tr>
                    ) : (
                      filteredHistory.map(record => {
                        const isUSD = record.currency === 'USD'; const isSell = record.type === 'sell';
                        let profit = 0; let yieldPct = 0; let profitKRW = 0;
                        if (isSell && record.avgBuyPrice) { 
                          profit = (record.price - record.avgBuyPrice) * record.quantity; 
                          yieldPct = ((record.price / record.avgBuyPrice) - 1) * 100; 
                          profitKRW = profit * (isUSD ? exchangeRate : 1); 
                        }
                        return (
                          <tr key={record.id} className="hover:bg-white transition-colors">
                            <td className="px-6 py-4 text-sm font-medium text-gray-600">{record.date}</td>
                            <td className="px-4 py-4 text-center">
                              <span className={`text-[10px] sm:text-xs font-extrabold px-2.5 py-1 rounded-lg border shadow-sm ${!isSell ? 'bg-red-50 text-red-600 border-red-100' : 'bg-blue-50 text-blue-600 border-blue-100'}`}>
                                {!isSell ? '매수' : '매도'}
                              </span>
                            </td>
                            <td className="px-6 py-4">
                              <div className="font-extrabold text-sm text-gray-900">{record.name}</div>
                              <div className="text-[10px] text-gray-400 font-mono mt-0.5">{record.ticker}</div>
                            </td>
                            <td className="px-6 py-4 text-right text-sm font-bold text-gray-700">{isUSD ? '$' : ''}{record.price.toLocaleString()}</td>
                            <td className="px-6 py-4 text-right text-sm font-bold text-gray-700">{record.quantity}주</td>
                            <td className="px-6 py-4 text-right">
                              {isSell && record.avgBuyPrice ? (
                                <div>
                                  <div className={`font-extrabold text-sm sm:text-base ${profit >= 0 ? 'text-red-500' : 'text-blue-500'}`}>
                                    {profit > 0 ? '+' : ''}{Math.round(profitKRW).toLocaleString()}원
                                  </div>
                                  <div className={`text-[10px] font-bold mt-0.5 inline-block px-1.5 py-0.5 rounded ${profit >= 0 ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'}`}>
                                    {profit > 0 ? '+' : ''}{yieldPct.toFixed(2)}%
                                  </div>
                                </div>
                              ) : <span className="text-gray-300 font-bold">-</span>}
                            </td>
                            <td className="px-4 py-4 text-center">
                              <button onClick={() => handleDeleteHistory(selectedAccountId, record.id)} className="text-gray-400 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50 transition-colors" title="내역 삭제">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 모달 6: 전체 누적 배당금 조회 필터링 모달 */}
      {isDividendModalOpen && (() => {
        const selectedAccount = accounts.find(a => a.id === selectedAccountId);
        const accountDividends = selectedAccount?.dividends || [];
        const filteredDividends = accountDividends.filter(record => {
          const matchStartDate = dividendFilter.startDate ? record.date >= dividendFilter.startDate : true;
          const matchEndDate = dividendFilter.endDate ? record.date <= dividendFilter.endDate : true;
          const matchTicker = dividendFilter.ticker ? record.ticker === dividendFilter.ticker : true;
          return matchStartDate && matchEndDate && matchTicker;
        }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        let totalDividendKRW = 0;
        filteredDividends.forEach(record => { totalDividendKRW += record.amount * (record.currency === 'USD' ? exchangeRate : 1); });
        const uniqueDividendStocks = Array.from(new Set(accountDividends.map(d => d.ticker))).map(ticker => {
            return { ticker, name: accountDividends.find(d => d.ticker === ticker).name };
        });

        return (
          <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl overflow-hidden max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-300">
              <div className="px-6 py-5 border-b border-gray-100 flex justify-between items-center bg-white shrink-0">
                <h3 className="text-lg sm:text-xl font-extrabold text-gray-900 flex items-center gap-2"><Coins className="w-5 h-5 text-yellow-500"/> 배당금 수령 내역</h3>
                <button onClick={() => setIsDividendModalOpen(false)} className="text-gray-400 hover:text-gray-700 p-1 rounded-full hover:bg-gray-100 transition-colors"><X size={24} /></button>
              </div>
              
              <div className="p-6 border-b border-gray-100 bg-gradient-to-r from-orange-50/50 to-white shrink-0">
                <p className="text-xs font-bold text-gray-500 mb-2 uppercase tracking-wider">조회 조건 배당금 총액</p>
                <div className="flex items-end gap-3">
                  <p className="text-3xl sm:text-4xl font-extrabold tracking-tight text-red-500">
                    +{Math.round(totalDividendKRW).toLocaleString()}원
                  </p>
                </div>
              </div>

              <div className="px-6 py-4 bg-white border-b border-gray-100 flex flex-wrap gap-3 items-center shrink-0">
                <div className="flex items-center gap-2">
                  <input type="date" className="px-3 py-2 border border-gray-200 rounded-xl text-sm font-semibold outline-none focus:ring-2 focus:ring-yellow-500/20" value={dividendFilter.startDate} onChange={(e) => setDividendFilter({ ...dividendFilter, startDate: e.target.value })} />
                  <span className="text-gray-400 text-sm font-bold">~</span>
                  <input type="date" className="px-3 py-2 border border-gray-200 rounded-xl text-sm font-semibold outline-none focus:ring-2 focus:ring-yellow-500/20" value={dividendFilter.endDate} onChange={(e) => setDividendFilter({ ...dividendFilter, endDate: e.target.value })} />
                </div>
                <select className="px-4 py-2 border border-gray-200 rounded-xl text-sm font-semibold outline-none focus:ring-2 focus:ring-yellow-500/20 bg-white" value={dividendFilter.ticker} onChange={(e) => setDividendFilter({ ...dividendFilter, ticker: e.target.value })}>
                  <option value="">전체 종목 보기</option>
                  {uniqueDividendStocks.map(stock => (<option key={stock.ticker} value={stock.ticker}>{stock.name} ({stock.ticker})</option>))}
                </select>
                {(dividendFilter.startDate || dividendFilter.endDate || dividendFilter.ticker) && (
                  <button onClick={() => setDividendFilter({ startDate: '', endDate: '', ticker: '' })} className="px-4 py-2 text-sm text-yellow-700 font-bold bg-yellow-50 hover:bg-yellow-100 rounded-xl transition-colors">필터 초기화</button>
                )}
              </div>

              <div className="overflow-y-auto overflow-x-auto hide-scrollbar bg-slate-50/30">
                <table className="w-full text-left border-collapse whitespace-nowrap min-w-[800px]">
                  <thead className="sticky top-0 bg-white shadow-sm z-10">
                    <tr className="text-gray-500 text-[10px] sm:text-xs uppercase tracking-wider border-b border-gray-200">
                      <th className="px-6 py-4 font-bold">입금 일자</th>
                      <th className="px-6 py-4 font-bold">종목명/티커</th>
                      <th className="px-6 py-4 font-bold text-right">총 수령 배당금</th>
                      <th className="px-6 py-4 font-bold text-right">원화 환산금액</th>
                      <th className="px-4 py-4 font-bold text-center w-20">관리</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredDividends.length === 0 ? (
                      <tr><td colSpan="5" className="px-6 py-16 text-center text-gray-400 font-medium text-sm">해당 조건의 배당금 입금 내역이 없습니다.</td></tr>
                    ) : (
                      filteredDividends.map(record => {
                        const isUSD = record.currency === 'USD';
                        return (
                          <tr key={record.id} className="hover:bg-white transition-colors">
                            <td className="px-6 py-4 text-sm font-medium text-gray-600">{record.date}</td>
                            <td className="px-6 py-4">
                              <div className="font-extrabold text-sm text-gray-900">{record.name}</div>
                              <div className="text-[10px] text-gray-400 font-mono mt-0.5">{record.ticker}</div>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <span className="font-extrabold text-sm text-gray-900 bg-gray-50 px-2 py-1 rounded-lg border border-gray-100 shadow-sm">
                                {isUSD ? '$' : ''}{record.amount.toLocaleString()} <span className="text-[10px] text-gray-400 ml-0.5 font-bold">{record.currency}</span>
                              </span>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <span className="font-extrabold text-sm sm:text-base text-red-500">
                                {Math.round(isUSD ? record.amount * exchangeRate : record.amount).toLocaleString()}원
                              </span>
                            </td>
                            <td className="px-4 py-4 text-center">
                              <button onClick={() => handleDeleteDividend(selectedAccountId, record.id)} className="text-gray-400 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50 transition-colors" title="내역 삭제">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 공통 확인 모달 (alert/confirm 대체) */}
      {confirmDialog.isOpen && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center z-[60] p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-300 p-6 text-center">
            <h3 className="text-lg font-extrabold text-gray-900 mb-2">확인</h3>
            <p className="text-sm text-gray-500 mb-6 font-medium whitespace-pre-wrap">{confirmDialog.message}</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDialog({ isOpen: false, message: '', onConfirm: null })} className="flex-1 px-4 py-3 bg-gray-100 text-gray-700 rounded-xl text-sm font-bold hover:bg-gray-200 transition-colors shadow-sm">취소</button>
              <button onClick={confirmDialog.onConfirm} className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition-colors shadow-sm shadow-blue-600/20">확인</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}