import { SelectControl } from "@/components/common/SelectControl";

type ParameterTablePagerProps = {
  page: number;
  pageCount: number;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
  onPageChange: (page: number) => void;
};

export function ParameterTablePager({
  page, pageCount, pageSize, onPageSizeChange, onPageChange
}: ParameterTablePagerProps) {
  return (
    <nav className="parameters-table-pagination" aria-label="参数分页">
      <label>
        每页条数
        <SelectControl
          value={String(pageSize)}
          ariaLabel="每页条数"
          onValueChange={(value) => onPageSizeChange(Number(value))}
          size="filter"
          compactControl="pagination"
          options={[50, 100, 200].map((size) => ({ value: String(size), label: size }))}
        />
      </label>
      <span>第 {page} / {pageCount} 页</span>
      <div>
        <button type="button" className="button subtle" disabled={page === 1}
          onClick={() => onPageChange(page - 1)}>上一页</button>
        <button type="button" className="button subtle" disabled={page === pageCount}
          onClick={() => onPageChange(page + 1)}>下一页</button>
      </div>
    </nav>
  );
}
