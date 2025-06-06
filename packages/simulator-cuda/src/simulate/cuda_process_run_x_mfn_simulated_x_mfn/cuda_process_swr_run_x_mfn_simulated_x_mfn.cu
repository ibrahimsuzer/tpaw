#include "cuda_process_swr_run_x_mfn_simulated_x_mfn.h"
#include "extern/doctest.h"
#include "extern/nanobench.h"
#include "src/public_headers/numeric_types.h"
#include "src/public_headers/stocks_and_bonds_float.h"
#include "src/simulate/cuda_process_historical_returns.h"
#include "src/utils/annual_to_monthly_returns.h"
#include "src/utils/bench_utils.h"
#include "src/utils/cuda_utils.h"
#include "src/utils/run_mfn_indexing.h"
#include <cstdint>
#include <sys/types.h>
#include <thrust/copy.h>
#include <thrust/device_vector.h>
#include <thrust/fill.h>
#include <thrust/functional.h>
#include <thrust/replace.h>
#include <thrust/sequence.h>
#include <thrust/transform.h>
#include <utility>

__device__ __host__ void
Cuda_Processed_SWR_Run_x_MFNSimulated_x_MFN::Entry::ApproxNPV::print(
    uint32_t num_tabs) const {
  const auto indent = static_cast<int32_t>(num_tabs * 4);
  printf("%*sincome_bond_rate_without_current_month: %.65f\n",
         indent,
         "",
         static_cast<CURRENCY>(income_bond_rate_without_current_month));
}

__device__ __host__ void
Cuda_Processed_SWR_Run_x_MFNSimulated_x_MFN::Entry::print(
    uint32_t num_tabs) const {
  const auto indent = static_cast<int32_t>(num_tabs * 4);
  printf("%*snpv_approx:\n", indent, "");
  npv_approx.print(num_tabs + 1);
}

// PlanParamsCuda_ByMFN but performant for kernal use.

struct __align__(32) _PlanParamsByMFN {
  CURRENCY_NPV income;
};

__global__ void
_kernel(uint32_t num_runs,
        uint32_t num_months_to_simulate,
        uint32_t num_months,
        const _PlanParamsByMFN *params_mfn_struct,
        const MonthlyAndAnnual<StocksAndBondsFLOAT>
            *expected_returns_by_run_by_mfn_simulated,
        Cuda_Processed_SWR_Run_x_MFNSimulated_x_MFN::Entry *result) {

  const uint32_t index{blockIdx.x * blockDim.x + threadIdx.x};
  const uint32_t run_index{index / num_months_to_simulate};
  if (run_index >= num_runs)
    return;
  const uint32_t month_index{index % num_months_to_simulate};

  const uint32_t run_by_mfn_index = get_run_by_mfn_index(
      num_runs, num_months_to_simulate, run_index, month_index);

  CURRENCY_NPV npv_income_bond_rate_with{CURRENCY_NPV_L(0.0)};

  const MonthlyAndAnnual<StocksAndBondsFLOAT> expected_returns =
      expected_returns_by_run_by_mfn_simulated[run_by_mfn_index];

  const FLOAT one_over_1p_bonds = __FLOAT_DIVIDE(
      FLOAT_L(1.0), (FLOAT_L(1.0) + expected_returns.monthly.bonds));

  // uint32_t cannot be used when counting down if the test condition is
  // >=0 , because 0 will wrap around instead of decrementing.
  auto num_months_int32 = static_cast<int32_t>(num_months);
  auto month_index_int32 = static_cast<int32_t>(month_index);
  for (int32_t ii = num_months_int32 - 1; ii >= month_index_int32; ii--) {
    const _PlanParamsByMFN curr_month_params = params_mfn_struct[ii];

    npv_income_bond_rate_with =
        CURRENCY_NPV_MA(npv_income_bond_rate_with,
                        static_cast<CURRENCY_NPV>(one_over_1p_bonds),
                        curr_month_params.income);
  }

  _PlanParamsByMFN curr_month_params = params_mfn_struct[month_index];

  result[run_by_mfn_index] = {
      .npv_approx =
          {
              .income_bond_rate_without_current_month = static_cast<CURRENCY>(
                  npv_income_bond_rate_with - curr_month_params.income),
          },
  };
}

thrust::device_vector<_PlanParamsByMFN>
_get_plan_params_mfn_optimized_gpu(const std::vector<CURRENCY> &income_by_mfn) {
  const uint32_t num_months = income_by_mfn.size();
  std::vector<_PlanParamsByMFN> plan_params_mfn_optimized_host(num_months);
  for (uint32_t i{0}; i < num_months; i++) {
    plan_params_mfn_optimized_host[i] = _PlanParamsByMFN{
        .income = static_cast<CURRENCY_NPV>(income_by_mfn[i]),
    };
  }
  const thrust::device_vector<_PlanParamsByMFN> result(
      plan_params_mfn_optimized_host);
  return result;
}

Cuda_Processed_SWR_Run_x_MFNSimulated_x_MFN
cuda_process_swr_run_x_mfn_simulated_x_mfn(
    const uint32_t num_runs,
    const uint32_t num_months_to_simulate,
    const uint32_t num_months,
    const std::vector<CURRENCY> &income_by_mfn,
    const thrust::device_vector<MonthlyAndAnnual<StocksAndBondsFLOAT>>
        &expected_returns_by_run_by_mfn_simulated) {

  const thrust::device_vector<_PlanParamsByMFN> plan_params_mfn_optimized_gpu =
      _get_plan_params_mfn_optimized_gpu(income_by_mfn);

  thrust::device_vector<Cuda_Processed_SWR_Run_x_MFNSimulated_x_MFN::Entry>
      for_normal_run(static_cast<size_t>(num_runs * num_months_to_simulate));

  const uint32_t block_size{64};
  _kernel<<<(num_runs * num_months_to_simulate + block_size - 1) / block_size,
            block_size>>>(num_runs,
                          num_months_to_simulate,
                          num_months,
                          plan_params_mfn_optimized_gpu.data().get(),
                          expected_returns_by_run_by_mfn_simulated.data().get(),
                          for_normal_run.data().get());
  gpuErrchk(cudaPeekAtLastError());
  gpuErrchk(cudaDeviceSynchronize());

  const Cuda_Processed_SWR_Run_x_MFNSimulated_x_MFN result{
      .for_normal_run = std::move(for_normal_run),
  };
  return result;
}

// *****************************************************************************
// TESTS
// *****************************************************************************

TEST_CASE("cuda_process_swr_run_x_mfn_simulated_x_mfn") {
  const uint32_t num_runs = 5;
  const uint32_t num_months = 30 * 12;
  const uint32_t num_months_to_simulate = num_months;
  std::vector<_PlanParamsByMFN> plan_params_mfn_host(num_months);
  for (uint32_t i{0}; i < num_months; i++) {
    plan_params_mfn_host[i] = _PlanParamsByMFN{
        .income = 0.0,
    };
  }
  thrust::device_vector<_PlanParamsByMFN> plan_params_mfn_gpu(
      plan_params_mfn_host);

  std::vector<MonthlyAndAnnual<StocksAndBondsFLOAT>>
      expected_returns_by_run_by_mfn_simulated_host(
          static_cast<size_t>(num_runs * num_months_to_simulate),
          {.monthly =
               StocksAndBondsFLOAT{
                   .stocks = annual_to_monthly_return(0.05),
                   .bonds = annual_to_monthly_return(0.03),
               },
           .annual = {
               .stocks = 0.05,
               .bonds = 0.03,
           }});
  thrust::device_vector<MonthlyAndAnnual<StocksAndBondsFLOAT>>
      expected_returns_by_run_by_mfn_simulated_gpu(
          expected_returns_by_run_by_mfn_simulated_host);

  thrust::device_vector<Cuda_Processed_SWR_Run_x_MFNSimulated_x_MFN::Entry>
      result_device(static_cast<size_t>(num_runs * num_months_to_simulate));

  const uint32_t block_size{64};
  _kernel<<<(num_runs * num_months_to_simulate + block_size - 1) / block_size,
            block_size>>>(
      num_runs,
      num_months_to_simulate,
      num_months,
      plan_params_mfn_gpu.data().get(),
      expected_returns_by_run_by_mfn_simulated_gpu.data().get(),
      result_device.data().get());
  gpuErrchk(cudaPeekAtLastError());
  gpuErrchk(cudaDeviceSynchronize());

  std::vector<Cuda_Processed_SWR_Run_x_MFNSimulated_x_MFN::Entry> result_host =
      device_vector_to_host(result_device);

  // Print out test_out_host with each run on a separate line
  //   for (uint32_t run = 0; run < num_runs; ++run) {
  //     std::cout << "Run " << run << ": ";
  //     for (uint32_t month = 0; month < num_months_to_simulate; ++month) {
  //       uint32_t index =
  //           get_run_by_mfn_index(num_runs, num_months_to_simulate, run,
  //           month);
  //       std::cout << result_host[index].stock_allocation << " ";
  //     }
  //     std::cout << std::endl;
  //   }
};

// *****************************************************************************
// BENCHES
// *****************************************************************************

TEST_CASE("bench::cuda_process_swr_run_x_mfn_simulated_x_mfn") {

  const auto do_bench = [](const char *name,
                           const uint32_t num_runs,
                           const uint32_t num_months,
                           const bool direct_kernel_call) {
    const uint32_t num_months_to_simulate = num_months;

    std::vector<CURRENCY> income_by_mfn(num_months, 1000.0);
    std::vector<CURRENCY> essential_expense_by_mfn(num_months, 400.0);
    std::vector<CURRENCY> discretionary_expense_by_mfn(num_months, 9000.0);
    std::vector<FLOAT> stock_allocation_savings_portfolio_by_mfn(num_months,
                                                                 0.5);
    std::vector<FLOAT> spending_tilt_by_mfn(num_months, 0.001);

    thrust::device_vector<_PlanParamsByMFN> plan_params_mfn_optimized_gpu =
        _get_plan_params_mfn_optimized_gpu(income_by_mfn);

    const StocksAndBondsFLOAT current_annual_expected_returns = {
        .stocks = (0.05),
        .bonds = (0.02),
    };
    const MonthlyAndAnnual<StocksAndBondsFLOAT> current_expected_returns = {
        .monthly =
            {
                .stocks = annual_to_monthly_return(
                    current_annual_expected_returns.stocks),
                .bonds = annual_to_monthly_return(
                    current_annual_expected_returns.bonds),
            },
        .annual = current_annual_expected_returns,
    };

    thrust::device_vector<MonthlyAndAnnual<StocksAndBondsFLOAT>>
        expected_returns_by_run_by_mfn_simulated_device(
            static_cast<size_t>(num_runs * num_months_to_simulate),
            current_expected_returns);

    ankerl::nanobench::Bench()
        .timeUnit(std::chrono::milliseconds{1}, "ms")
        .run(name, [&]() {
          thrust::device_vector<
              Cuda_Processed_SWR_Run_x_MFNSimulated_x_MFN::Entry>
              result(static_cast<size_t>(num_runs * num_months_to_simulate));

          if (direct_kernel_call) {
            const uint32_t block_size{64};
            _kernel<<<(num_runs * num_months_to_simulate + block_size - 1) /
                          block_size,
                      block_size>>>(
                num_runs,
                num_months_to_simulate,
                num_months,
                plan_params_mfn_optimized_gpu.data().get(),
                expected_returns_by_run_by_mfn_simulated_device.data().get(),
                result.data().get());
            gpuErrchk(cudaPeekAtLastError());
            gpuErrchk(cudaDeviceSynchronize());
          } else {
            cuda_process_swr_run_x_mfn_simulated_x_mfn(
                num_runs,
                num_months_to_simulate,
                num_months,
                income_by_mfn,
                expected_returns_by_run_by_mfn_simulated_device);
          }
        });
  };

  for (const auto &direct_kernel_call : std::vector<bool>{true, false}) {
    for (const auto &num_runs : bench_num_runs_vec) {
      for (const auto &num_years : bench_num_years_vec) {
        do_bench((std::string("cuda_process_swr_run_x_mfn_simulated_x_mfn::") +
                  std::to_string(num_runs) + "x" + std::to_string(num_years) +
                  (direct_kernel_call ? "xdirect" : "xindirect"))
                     .c_str(),
                 num_runs,
                 num_years * 12,
                 direct_kernel_call);
      }
    }
  }
}

TEST_CASE("bench::cuda_process_swr_run_x_mfn_simulated_x_mfn::optimize_plan_"
          "params_mfn") {
  const auto do_bench = [](const char *name,
                           const uint32_t num_runs,
                           const uint32_t num_months) {
    const uint32_t num_months_to_simulate = num_months;

    std::vector<CURRENCY> income_by_mfn(num_months, 1000.0);
    std::vector<CURRENCY> essential_expense_by_mfn(num_months, 400.0);
    std::vector<CURRENCY> discretionary_expense_by_mfn(num_months, 9000.0);
    std::vector<FLOAT> stock_allocation_savings_portfolio_by_mfn(num_months,
                                                                 0.5);
    std::vector<FLOAT> spending_tilt_by_mfn(num_months, 0.001);
    ankerl::nanobench::Bench()
        .timeUnit(std::chrono::milliseconds{1}, "ms")
        .run(name, [&]() {
          thrust::device_vector<
              Cuda_Processed_SWR_Run_x_MFNSimulated_x_MFN::Entry>
              result(static_cast<size_t>(num_runs * num_months_to_simulate));
          _get_plan_params_mfn_optimized_gpu(income_by_mfn);
        });
  };

  for (const auto &num_runs : bench_num_runs_vec) {
    for (const auto &num_years : bench_num_years_vec) {
      do_bench((std::string("cuda_process_swr_run_x_mfn_simulated_x_mfn::"
                            "optimize_plan_params_mfn::") +
                std::to_string(num_runs) + "x" + std::to_string(num_years))
                   .c_str(),
               num_runs,
               num_years * 12);
    }
  }
}
