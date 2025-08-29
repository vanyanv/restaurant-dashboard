"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Checkbox } from "@/components/ui/checkbox"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { ChevronRight, ChevronLeft, Check } from "lucide-react"
import { toast } from "sonner"
import { StoreSelector } from "./store-selector"

interface DailyReportFormProps {
  managerId: string
  managerName: string
}

type FormSection = "basic" | "till" | "checklist" | "prep"

interface FormData {
  storeId: string
  date: string
  shift: "MORNING" | "EVENING" | ""
  managerName: string
  startingAmount: string
  endingAmount: string
  cashTips: string
  checklist: { [key: string]: boolean }
  prep: {
    prepMeat: boolean
    prepSauce: boolean
    prepOnionsSliced: boolean
    prepOnionsDiced: boolean
    prepTomatoesSliced: boolean
    prepLettuce: boolean
  }
}

const checklistTasks = [
  "Brush outside with hot water and soap",
  "Setup and clean all tables and countertops",
  "Pour hot water in the soda machine",
  "Set up the soda machine",
  "Refill paper towels in restroom and handwashing sink",
  "Set up condiments",
  "Set up trashcans",
  "Check restrooms for cleanliness",
  "Check temperature: <80°F open door (no AC), >80°F close door (turn on AC)"
]

export function DailyReportForm({ managerId, managerName }: DailyReportFormProps) {
  const router = useRouter()
  const [currentSection, setCurrentSection] = useState<FormSection>("basic")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [existingReport, setExistingReport] = useState<any>(null)
  const [isLoadingReport, setIsLoadingReport] = useState(false)
  
  const [formData, setFormData] = useState<FormData>({
    storeId: "",
    date: new Date().toISOString().split('T')[0],
    shift: "",
    managerName: managerName,
    startingAmount: "",
    endingAmount: "",
    cashTips: "",
    checklist: {},
    prep: {
      prepMeat: false,
      prepSauce: false,
      prepOnionsSliced: false,
      prepOnionsDiced: false,
      prepTomatoesSliced: false,
      prepLettuce: false
    }
  })

  // Function to load existing report
  const loadExistingReport = async (storeId: string, date: string, shift: string) => {
    if (!storeId || !date || !shift) {
      setExistingReport(null)
      return
    }

    setIsLoadingReport(true)
    try {
      const response = await fetch(`/api/reports?date=${date}&shift=${shift}`)
      if (response.ok) {
        const reports = await response.json()
        const report = reports.find((r: any) => 
          new Date(r.date).toISOString().split('T')[0] === date && r.shift === shift
        )
        
        if (report) {
          setExistingReport(report)
          // Load existing data into form
          setFormData(prev => ({
            ...prev,
            startingAmount: report.startingAmount?.toString() || "",
            endingAmount: report.endingAmount?.toString() || "",
            cashTips: report.cashTips?.toString() || "",
            prep: {
              prepMeat: report.prepMeat || false,
              prepSauce: report.prepSauce || false,
              prepOnionsSliced: report.prepOnionsSliced || false,
              prepOnionsDiced: report.prepOnionsDiced || false,
              prepTomatoesSliced: report.prepTomatoesSliced || false,
              prepLettuce: report.prepLettuce || false
            }
            // Note: checklist data not stored in DB, so keep from localStorage
          }))
        } else {
          setExistingReport(null)
        }
      }
    } catch (error) {
      console.error("Failed to load existing report:", error)
      setExistingReport(null)
    } finally {
      setIsLoadingReport(false)
    }
  }

  // Load existing report when store, date and shift change
  useEffect(() => {
    if (formData.storeId && formData.date && formData.shift) {
      loadExistingReport(formData.storeId, formData.date, formData.shift)
    } else {
      setExistingReport(null)
    }
  }, [formData.storeId, formData.date, formData.shift])

  // Auto-save functionality
  useEffect(() => {
    const savedData = localStorage.getItem(`daily-report-${formData.date}`)
    if (savedData && !existingReport) {
      try {
        const parsed = JSON.parse(savedData)
        setFormData(prev => ({ ...prev, ...parsed }))
      } catch (e) {
        console.error("Failed to load saved data:", e)
      }
    }
  }, [formData.date, existingReport])

  useEffect(() => {
    localStorage.setItem(`daily-report-${formData.date}`, JSON.stringify(formData))
  }, [formData])

  const getSectionProgress = () => {
    switch (currentSection) {
      case "basic":
        return formData.storeId && formData.shift && formData.managerName ? 100 : 33
      case "till":
        const tillFields = [formData.startingAmount, formData.endingAmount, formData.cashTips]
        return (tillFields.filter(Boolean).length / tillFields.length) * 100
      case "checklist":
        const completedTasks = Object.values(formData.checklist).filter(Boolean).length
        return (completedTasks / checklistTasks.length) * 100
      case "prep":
        const completedPrepTasks = Object.values(formData.prep).filter(Boolean).length
        const totalPrepTasks = Object.keys(formData.prep).length
        return (completedPrepTasks / totalPrepTasks) * 100
      default:
        return 0
    }
  }

  const getOverallProgress = () => {
    const sections = ["basic", "till", "checklist", "prep"] as FormSection[]
    const totalProgress = sections.reduce((acc, section) => {
      // Calculate progress without changing state
      let sectionProgress = 0
      switch (section) {
        case "basic":
          sectionProgress = formData.storeId && formData.shift && formData.managerName ? 100 : 33
          break
        case "till":
          const tillFields = [formData.startingAmount, formData.endingAmount, formData.cashTips]
          sectionProgress = (tillFields.filter(Boolean).length / tillFields.length) * 100
          break
        case "checklist":
          const completedTasks = Object.values(formData.checklist).filter(Boolean).length
          sectionProgress = (completedTasks / checklistTasks.length) * 100
          break
        case "prep":
          const completedPrepTasks = Object.values(formData.prep).filter(Boolean).length
          const totalPrepTasks = Object.keys(formData.prep).length
          sectionProgress = (completedPrepTasks / totalPrepTasks) * 100
          break
        default:
          sectionProgress = 0
      }
      return acc + sectionProgress
    }, 0)
    return totalProgress / sections.length
  }

  const handleNext = () => {
    switch (currentSection) {
      case "basic":
        setCurrentSection("till")
        break
      case "till":
        setCurrentSection("checklist")
        break
      case "checklist":
        setCurrentSection("prep")
        break
    }
  }

  const handleBack = () => {
    switch (currentSection) {
      case "till":
        setCurrentSection("basic")
        break
      case "checklist":
        setCurrentSection("till")
        break
      case "prep":
        setCurrentSection("checklist")
        break
    }
  }

  const handleSubmit = async () => {
    setIsSubmitting(true)
    try {
      if (!formData.storeId) {
        toast.error("Please select a store")
        return
      }

      const storeId = formData.storeId

      // Calculate prep completion percentages
      const checklistProgress = (Object.values(formData.checklist).filter(Boolean).length / checklistTasks.length) * 100
      
      const reportData = {
        storeId,
        date: formData.date,
        shift: formData.shift,
        startingAmount: parseFloat(formData.startingAmount) || 0,
        endingAmount: parseFloat(formData.endingAmount) || 0,
        tipCount: 0, // Legacy field, keeping as 0
        cashTips: parseFloat(formData.cashTips) || 0,
        morningPrepCompleted: formData.shift === "MORNING" ? Math.round(checklistProgress) : 0,
        eveningPrepCompleted: formData.shift === "EVENING" ? Math.round(checklistProgress) : 0,
        // Prep completion checkboxes
        prepMeat: formData.prep.prepMeat,
        prepSauce: formData.prep.prepSauce,
        prepOnionsSliced: formData.prep.prepOnionsSliced,
        prepOnionsDiced: formData.prep.prepOnionsDiced,
        prepTomatoesSliced: formData.prep.prepTomatoesSliced,
        prepLettuce: formData.prep.prepLettuce,
      }

      const response = await fetch("/api/reports", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(reportData)
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Failed to submit report")
      }

      const action = existingReport ? "updated" : "created"
      toast.success(`Daily report ${action} successfully!`)
      localStorage.removeItem(`daily-report-${formData.date}`)
      
      // Reset form
      setFormData({
        storeId: formData.storeId, // Keep store selection
        date: new Date().toISOString().split('T')[0],
        shift: "",
        managerName: managerName,
        startingAmount: "",
        endingAmount: "",
        cashTips: "",
        checklist: {},
        prep: {
          prepMeat: false,
          prepSauce: false,
          prepOnionsSliced: false,
          prepOnionsDiced: false,
          prepTomatoesSliced: false,
          prepLettuce: false
        }
      })
      setCurrentSection("basic")
      
    } catch (error: any) {
      toast.error(error.message || "Failed to submit report. Please try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  const renderBasicInfo = () => (
    <div className="space-y-6">
      <StoreSelector
        value={formData.storeId}
        onChange={(storeId) => setFormData(prev => ({ ...prev, storeId }))}
      />
      
      <div>
        <Label htmlFor="date" className="text-lg font-medium">Date</Label>
        <Input
          id="date"
          type="date"
          value={formData.date}
          onChange={(e) => setFormData(prev => ({ ...prev, date: e.target.value }))}
          className="mt-2 text-lg h-14"
        />
      </div>
      
      <div>
        <Label className="text-lg font-medium">Shift Type</Label>
        <RadioGroup
          value={formData.shift}
          onValueChange={(value) => setFormData(prev => ({ ...prev, shift: value as "MORNING" | "EVENING" }))}
          className="mt-3 space-y-4"
        >
          <div className="flex items-center space-x-3 p-4 border rounded-lg">
            <RadioGroupItem value="MORNING" id="morning" className="h-5 w-5" />
            <Label htmlFor="morning" className="text-lg font-medium cursor-pointer">
              🌅 Morning Shift
            </Label>
          </div>
          <div className="flex items-center space-x-3 p-4 border rounded-lg">
            <RadioGroupItem value="EVENING" id="evening" className="h-5 w-5" />
            <Label htmlFor="evening" className="text-lg font-medium cursor-pointer">
              🌆 Evening Shift
            </Label>
          </div>
        </RadioGroup>
      </div>
      
      <div>
        <Label htmlFor="managerName" className="text-lg font-medium">Manager Name</Label>
        <Input
          id="managerName"
          value={formData.managerName}
          onChange={(e) => setFormData(prev => ({ ...prev, managerName: e.target.value }))}
          placeholder="Enter your name"
          className="mt-2 text-lg h-14"
        />
      </div>
    </div>
  )

  const renderTillInfo = () => (
    <div className="space-y-6">
      <div>
        <Label htmlFor="startingAmount" className="text-lg font-medium">Starting Til (w/ Coins)</Label>
        <div className="relative mt-2">
          <span className="absolute left-3 top-4 text-lg text-muted-foreground">$</span>
          <Input
            id="startingAmount"
            type="number"
            step="0.01"
            value={formData.startingAmount}
            onChange={(e) => setFormData(prev => ({ ...prev, startingAmount: e.target.value }))}
            placeholder="0.00"
            className="pl-8 text-lg h-14"
          />
        </div>
      </div>
      
      <div>
        <Label htmlFor="endingAmount" className="text-lg font-medium">Ending Til (w/ Coins)</Label>
        <div className="relative mt-2">
          <span className="absolute left-3 top-4 text-lg text-muted-foreground">$</span>
          <Input
            id="endingAmount"
            type="number"
            step="0.01"
            value={formData.endingAmount}
            onChange={(e) => setFormData(prev => ({ ...prev, endingAmount: e.target.value }))}
            placeholder="0.00"
            className="pl-8 text-lg h-14"
          />
        </div>
      </div>
      
      <div>
        <Label htmlFor="cashTips" className="text-lg font-medium">Cash Tips</Label>
        <div className="relative mt-2">
          <span className="absolute left-3 top-4 text-lg text-muted-foreground">$</span>
          <Input
            id="cashTips"
            type="number"
            step="0.01"
            value={formData.cashTips}
            onChange={(e) => setFormData(prev => ({ ...prev, cashTips: e.target.value }))}
            placeholder="0.00"
            className="pl-8 text-lg h-14"
          />
        </div>
      </div>
    </div>
  )

  const renderChecklist = () => (
    <div className="space-y-4">
      <div className="text-center">
        <div className="text-2xl font-bold text-primary">
          {Object.values(formData.checklist).filter(Boolean).length}/{checklistTasks.length}
        </div>
        <div className="text-sm text-muted-foreground">Tasks Completed</div>
      </div>
      
      <Progress value={getSectionProgress()} className="h-3" />
      
      <div className="space-y-3 mt-6">
        {checklistTasks.map((task, index) => (
          <div key={index} className="flex items-center space-x-3 p-4 border rounded-lg">
            <Checkbox
              id={`task-${index}`}
              checked={formData.checklist[task] || false}
              onCheckedChange={(checked) => 
                setFormData(prev => ({
                  ...prev,
                  checklist: { ...prev.checklist, [task]: !!checked }
                }))
              }
              className="h-6 w-6"
            />
            <Label 
              htmlFor={`task-${index}`} 
              className="text-sm cursor-pointer leading-5 flex-1"
            >
              {task}
            </Label>
            {formData.checklist[task] && (
              <Check className="h-5 w-5 text-green-600" />
            )}
          </div>
        ))}
      </div>
    </div>
  )

  const prepTasks = [
    { key: "prepMeat", label: "🥩 Prepared meat (ready for cooking)" },
    { key: "prepSauce", label: "🍅 Prepared sauce (ready for service)" },
    { key: "prepOnionsSliced", label: "🧅 Sliced onions (ready for service)" },
    { key: "prepOnionsDiced", label: "🧅 Diced onions (ready for cooking)" },
    { key: "prepTomatoesSliced", label: "🍅 Sliced tomatoes (ready for service)" },
    { key: "prepLettuce", label: "🥬 Prepared lettuce (washed and chopped)" }
  ]

  const renderPrepInfo = () => (
    <div className="space-y-4">
      <div className="text-center">
        <div className="text-2xl font-bold text-primary">
          {Object.values(formData.prep).filter(Boolean).length}/{prepTasks.length}
        </div>
        <div className="text-sm text-muted-foreground">Prep Tasks Completed</div>
      </div>
      
      <Progress value={getSectionProgress()} className="h-3" />
      
      <div className="space-y-3 mt-6">
        {prepTasks.map(({ key, label }) => (
          <div key={key} className="flex items-center space-x-3 p-4 border rounded-lg">
            <Checkbox
              id={`prep-${key}`}
              checked={formData.prep[key as keyof typeof formData.prep]}
              onCheckedChange={(checked) => 
                setFormData(prev => ({
                  ...prev,
                  prep: { ...prev.prep, [key]: !!checked }
                }))
              }
              className="h-6 w-6"
            />
            <Label 
              htmlFor={`prep-${key}`} 
              className="text-sm cursor-pointer leading-5 flex-1"
            >
              {label}
            </Label>
            {formData.prep[key as keyof typeof formData.prep] && (
              <Check className="h-5 w-5 text-green-600" />
            )}
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <Card className="w-full">
      <CardHeader className="text-center pb-4">
        <CardTitle className="text-xl">
          {currentSection === "basic" && "📋 Basic Information"}
          {currentSection === "till" && "💰 Till & Tips"}
          {currentSection === "checklist" && "✅ Before Open Checklist"}
          {currentSection === "prep" && "🥘 Prep Completion"}
        </CardTitle>
        {existingReport && (
          <p className="text-sm text-orange-600 font-medium mt-2">
            ✏️ Editing existing report from {new Date(existingReport.createdAt).toLocaleDateString()}
          </p>
        )}
        {isLoadingReport && (
          <p className="text-sm text-muted-foreground mt-2">
            Loading existing report...
          </p>
        )}
        <div className="mt-4">
          <Progress value={getOverallProgress()} className="h-2" />
          <p className="text-sm text-muted-foreground mt-2">
            Overall Progress: {Math.round(getOverallProgress())}%
          </p>
        </div>
      </CardHeader>
      
      <CardContent>
        {currentSection === "basic" && renderBasicInfo()}
        {currentSection === "till" && renderTillInfo()}
        {currentSection === "checklist" && renderChecklist()}
        {currentSection === "prep" && renderPrepInfo()}
        
        <Separator className="my-6" />
        
        <div className="flex justify-between">
          {currentSection !== "basic" ? (
            <Button variant="outline" onClick={handleBack} className="h-12 px-6">
              <ChevronLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          ) : (
            <div />
          )}
          
          {currentSection !== "prep" ? (
            <Button onClick={handleNext} className="h-12 px-6">
              Next
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          ) : (
            <Button 
              onClick={handleSubmit} 
              disabled={isSubmitting || isLoadingReport}
              className="h-12 px-6"
            >
              {isSubmitting 
                ? (existingReport ? "Updating..." : "Submitting...") 
                : (existingReport ? "Update Report" : "Submit Report")
              }
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}